import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { commandDefinition } from './src/commands.js'
import { detectProviders } from './src/detect.js'
import { bindHostPower, bindPowerMonitor } from './src/power.js'
import { queryClaude } from './src/providers/claude.js'
import { queryCodex } from './src/providers/codex.js'
import { queryGlm } from './src/providers/glm.js'
import { queryOpenCode } from './src/providers/opencode.js'
import { queryGrok } from './src/providers/placeholders.js'
import { redactText } from './src/redact.js'
import { GLM_ACCOUNT, OPENCODE_ACCOUNT, createSecretStore, processRunner } from './src/secrets.js'
import { registerQuotaRemote } from './src/remote.js'
import { createQuotaService } from './src/service.js'
import { createSettingsStore } from './src/settings.js'

const root = path.dirname(fileURLToPath(import.meta.url))

export function pluginDataDir(config = {}) {
  if (typeof config.dataDir === 'string' && config.dataDir.length > 0) return config.dataDir
  const home = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  const base = home || path.join(os.homedir(), '.dsh')
  return path.join(base, 'provider-quota-rings')
}

export function createWiredService(config = {}) {
  const settings = createSettingsStore(pluginDataDir(config))
  if (config.liveReads === true || config.liveReads === false) settings.save({ liveReads: config.liveReads })
  const helper = path.join(root, 'bin', 'quota-keychain')
  const script = path.join(root, 'native', 'dpapi.ps1')
  const secrets = createSecretStore({
    runner: config.secretRunner ?? processRunner,
    helperPath: config.helperPath === undefined ? (fs.existsSync(helper) ? helper : null) : config.helperPath,
    scriptPath: fs.existsSync(script) ? script : null,
    platform: config.platform,
  })
  const queries = {
    codex: ({ signal, liveReads }) => queryCodex({
      liveReads,
      spawn: config.spawn ?? spawn,
      signal,
      stop: config.stopChild,
    }),
    claude: ({ signal, liveReads }) => queryClaude({
      liveReads,
      signal,
      queryFactory: config.claudeQuery,
      importSdk: config.claudeImport,
    }),
    opencode: async ({ signal, liveReads }) => {
      if (!liveReads) return queryOpenCode({ liveReads: false })
      if (settings.get().opencodeKeyStored !== true) return queryOpenCode({ liveReads: true })
      const loaded = await secrets.get(OPENCODE_ACCOUNT)
      if (!loaded?.ok || typeof loaded.secret !== 'string' || loaded.secret.length === 0) {
        return { ok: false, code: 'needs-key', message: '钥匙串里没有 OpenCode Go 密钥。' }
      }
      const token = loaded.secret
      try {
        return await queryOpenCode({
          liveReads: true,
          token,
          fetch: config.fetchImpl ?? globalThis.fetch,
          signal,
        })
      } catch (error) {
        return {
          ok: false,
          code: 'opencode-failed',
          message: redactText(error instanceof Error ? error.message : 'OpenCode Go 查询失败', [token]),
        }
      }
    },
    grok: () => queryGrok(),
    glm: async ({ signal, platform, liveReads }) => {
      if (settings.get().glmKeyStored !== true) return queryGlm({ liveReads, platform, hasToken: false })
      if (!liveReads) return queryGlm({ liveReads: false, platform, hasToken: true })
      const loaded = await secrets.get(GLM_ACCOUNT)
      if (!loaded?.ok || typeof loaded.secret !== 'string' || loaded.secret.length === 0) {
        return { ok: false, code: 'needs-key', message: '钥匙串里没有 GLM 密钥。' }
      }
      const token = loaded.secret
      try {
        return await queryGlm({
          liveReads: true,
          platform,
          hasToken: true,
          token,
          fetch: config.fetchImpl ?? globalThis.fetch,
          signal,
          now: config.now,
        })
      } catch (error) {
        return {
          ok: false,
          code: 'glm-failed',
          message: redactText(error instanceof Error ? error.message : 'GLM 查询失败', [token]),
        }
      }
    },
  }
  return createQuotaService({
    settings,
    secrets,
    queries,
    detect: config.detect,
    now: config.now,
    intervalMs: config.intervalMs,
    setTimer: config.setTimer,
    clearTimer: config.clearTimer,
  })
}

export const inject = ['commands']

/** Host entry. The five-minute refresh stays in memory. Sidebar reads use the quota remote, not the session command. */
export function apply(ctx, config = {}) {
  const service = createWiredService({ ...config, detect: () => detectProviders(ctx) })
  const remote = registerQuotaRemote(ctx, service, config.now)
  const definition = commandDefinition(service)
  if (typeof ctx?.inject === 'function') {
    ctx.inject(['commands'], (scope) => {
      const commands = typeof scope.get === 'function' ? scope.get('commands') : scope.commands
      const register = () => commands.register(definition)
      if (typeof scope.effect === 'function') scope.effect(register)
      else register()
    })
  } else if (ctx?.commands?.register) {
    ctx.commands.register(definition)
  }
  let unbindPower = () => {}
  const unbindHostPower = bindHostPower(ctx, service)
  if (config.powerMonitor) unbindPower = bindPowerMonitor(config.powerMonitor, service)
  else if (process.versions?.electron) {
    import('electron').then((mod) => {
      const monitor = mod?.powerMonitor ?? mod?.default?.powerMonitor
      if (monitor) unbindPower = bindPowerMonitor(monitor, service)
    }).catch(() => {})
  }
  const stop = () => {
    unbindPower()
    unbindHostPower()
    service.dispose()
    try { remote.dispose() } catch { /* fiber cleanup is idempotent when the host owns it */ }
  }
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => {
      service.start()
      return stop
    })
  } else {
    service.start()
  }
  return stop
}
