import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { handleQuotaCommand } from '../src/commands.js'
import { toDisplay } from '../src/display.js'
import { bindHostPower, bindPowerMonitor } from '../src/power.js'
import { footerElement, dialogElement } from '../src/view.js'
import { createQuotaService } from '../src/service.js'
import { createSettingsStore } from '../src/settings.js'
import { createSecretStore } from '../src/secrets.js'

const hour = 60 * 60 * 1000

function react() {
  return {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat().filter((child) => child != null) }
    },
  }
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'quota-rings-'))
}

function harness(overrides = {}) {
  const calls = []
  const settings = overrides.settings ?? {
    state: { disabled: {}, glmPlatform: 'zhipu', liveReads: false, glmKeyStored: false },
    get() { return this.state },
    save(patch) { this.state = { ...this.state, ...patch, disabled: patch.disabled ?? this.state.disabled } },
  }
  const queries = {
    codex: () => ({ ok: false, code: 'live-reads-disabled', message: '未授权调用本地 codex。' }),
    claude: () => ({ ok: false, code: 'source-unverified', experimental: true, message: '没有 claude 接口' }),
    opencode: () => ({ ok: false, code: 'source-unverified', experimental: true, message: '没有 opencode 接口' }),
    grok: () => ({ ok: true, unread: true, link: { href: 'https://grok.com', label: 'Grok 官网' }, message: '暂无法读取' }),
    glm: () => ({ ok: false, code: 'needs-key', message: '未配置 GLM 密钥。' }),
    ...overrides.queries,
  }
  const wrapped = {}
  for (const [name, query] of Object.entries(queries)) {
    wrapped[name] = async (input) => {
      calls.push({ name, input })
      return query(input)
    }
  }
  const timers = []
  let clock = overrides.clock ?? 1_700_000_000_000
  const service = createQuotaService({
    settings,
    secrets: overrides.secrets,
    queries: wrapped,
    now: () => clock,
    intervalMs: overrides.intervalMs ?? 300000,
    setTimer(fn, ms) {
      const id = timers.length + 1
      timers.push({ id, fn, ms })
      return id
    },
    clearTimer(id) {
      const index = timers.findIndex((item) => item.id === id)
      if (index >= 0) timers.splice(index, 1)
    },
  })
  return {
    service,
    settings,
    calls,
    timers,
    set clock(value) { clock = value },
    get clock() { return clock },
    fire() {
      const item = timers.shift()
      item.fn()
    },
  }
}

test('failure keeps the last success, disable skips the query, and dispose aborts it', async () => {
  let mode = 'ok'
  const box = harness({
    queries: {
      codex: () => (mode === 'ok'
        ? {
          ok: true,
          windows: [{ label: 'Codex 300 分钟', scope: 'model', durationMs: 5 * hour, usedRatio: 0.25 }],
          source: 'codex account/rateLimits/read',
        }
        : { ok: false, code: 'down', message: '暂时失败' }),
    },
  })
  await box.service.refreshOne('codex')
  const fresh = box.service.snapshot().byId.codex
  assert.equal(fresh.status, 'fresh')
  mode = 'down'
  await box.service.refreshOne('codex')
  const stale = box.service.snapshot().byId.codex
  assert.equal(stale.status, 'stale')
  assert.equal(stale.updatedAt, fresh.updatedAt)
  assert.equal(stale.windows[0].usedRatio, 0.25)
  assert.match(stale.error, /暂时失败/)

  let disabledCalls = 0
  const disabled = harness({
    queries: { codex: () => { disabledCalls += 1; return { ok: true, windows: [] } } },
  })
  disabled.service.setDisabled('codex', true)
  await disabled.service.refreshOne('codex')
  assert.equal(disabledCalls, 0)
  assert.equal(disabled.service.snapshot().byId.codex.status, 'disabled')

  let aborted = false
  const hanging = harness({
    queries: {
      codex: ({ signal }) => new Promise((resolve) => {
        signal.addEventListener('abort', () => { aborted = true; resolve({ ok: false, code: 'aborted' }) })
      }),
    },
  })
  const pending = hanging.service.refreshAll()
  hanging.service.dispose()
  await pending
  assert.equal(aborted, true)
  hanging.service.dispose()
})

test('a GLM success:false result keeps the previous cache stale instead of going fresh', async () => {
  let mode = 'ok'
  const box = harness({
    queries: {
      glm: () => (mode === 'ok'
        ? {
          ok: true,
          windows: [{ label: 'Token 用量（5 小时）', scope: 'model', durationMs: 5 * hour, usedRatio: 0.2 }],
          source: 'GET /api/monitor/usage/quota/limit',
        }
        : { ok: false, code: 'glm-rejected', message: 'GLM 返回 success=false，额度不可读，已保留上次结果。' }),
    },
  })
  await box.service.refreshOne('glm')
  const fresh = box.service.snapshot().byId.glm
  assert.equal(fresh.status, 'fresh')
  assert.equal(fresh.windows[0].usedRatio, 0.2)
  mode = 'rejected'
  await box.service.refreshOne('glm')
  const stale = box.service.snapshot().byId.glm
  assert.equal(stale.status, 'stale')
  assert.equal(stale.updatedAt, fresh.updatedAt)
  assert.equal(stale.windows[0].usedRatio, 0.2)
  assert.equal(stale.code, 'glm-rejected')
  assert.match(stale.error, /success=false/)
  assert.equal(stale.status === 'fresh', false)
})

test('manual and timer refresh share one in-flight batch, and rate limits wait per provider', async () => {
  let release
  let codexCalls = 0
  const box = harness({
    queries: {
      codex: () => {
        codexCalls += 1
        return new Promise((resolve) => { release = () => resolve({ ok: true, windows: [] }) })
      },
    },
  })
  const first = box.service.refreshAll()
  const second = box.service.refreshAll()
  assert.equal(first, second)
  release()
  await first
  assert.equal(codexCalls, 1)

  let limited = 0
  const rated = harness({
    queries: {
      codex: () => {
        limited += 1
        return { ok: false, code: 'rate-limited', message: '稍后', retryAfterMs: 5000 }
      },
    },
  })
  await rated.service.refreshOne('codex')
  rated.clock += 1000
  await rated.service.refreshOne('codex')
  assert.equal(limited, 1)
  rated.clock += 5000
  await rated.service.refreshOne('codex')
  assert.equal(limited, 2)
})

test('glm platforms keep separate caches and grok is not a fresh success', async () => {
  const box = harness({
    queries: {
      glm: ({ platform }) => ({
        ok: true,
        windows: [{ label: platform, scope: 'model', durationMs: 5 * hour, usedRatio: platform === 'zai' ? 0.1 : 0.4 }],
        source: 'GET /api/monitor/usage/quota/limit',
      }),
    },
  })
  await box.service.refreshAll()
  assert.equal(box.service.snapshot().byId.glm.windows[0].usedRatio, 0.4)
  assert.equal(box.service.snapshot().byId.grok.status, 'unread')
  box.service.setGlmPlatform('zai')
  assert.equal(box.service.snapshot().byId.glm.status, 'unknown')
  await box.service.refreshOne('glm')
  assert.equal(box.service.snapshot().byId.glm.windows[0].usedRatio, 0.1)
  box.service.setGlmPlatform('zhipu')
  assert.equal(box.service.snapshot().byId.glm.windows[0].usedRatio, 0.4)
  const display = toDisplay(box.service.snapshot())
  assert.equal(display.rows.find((row) => row.id === 'glm').platformLabel, '智谱')
  assert.equal(display.rows.find((row) => row.id === 'grok').status, 'unread')
})

test('resume after pause refreshes once, and a late timer is the sleep catch-up', async () => {
  const box = harness()
  await box.service.start()
  const before = box.calls.length
  box.service.pause()
  assert.equal(box.timers.length, 0)
  box.service.resume()
  await box.service.refreshAll()
  assert.ok(box.calls.length > before)
  const armed = box.calls.length
  box.clock += 300000 + 5000
  box.fire()
  await Promise.resolve()
  assert.ok(box.calls.length > armed)
  box.service.dispose()
  assert.equal(box.timers.length, 0)
})

test('commands and settings never persist the glm token', async () => {
  const dir = await tempDir()
  const token = 'super-secret-value'
  const calls = []
  const settings = createSettingsStore(dir)
  const secrets = createSecretStore({
    platform: 'darwin',
    helperPath: path.join(dir, 'helper'),
    runner: async ({ args, stdin }) => {
      calls.push({ args, stdin })
      return { code: 0, stdout: '{"ok":true,"op":"set"}\n', args, stderr: '' }
    },
  })
  const box = harness({ settings, secrets })
  const saved = await handleQuotaCommand(box.service, { rawInput: `store ${token}` })
  assert.equal(saved.kind, 'success')
  assert.equal(saved.text.includes(token), false)
  assert.equal(calls[0].args.length, 0)
  assert.match(calls[0].stdin, /super-secret-value/)
  assert.equal((await fs.readFile(settings.file, 'utf8')).includes(token), false)
  assert.equal(JSON.stringify(box.service.snapshot()).includes(token), false)
  const shown = await handleQuotaCommand(box.service, { rawInput: '' })
  assert.equal(shown.text.includes(token), false)
  await fs.rm(dir, { recursive: true, force: true })
})

test('a poisoned settings file is rewritten without secret keys', async () => {
  const dir = await tempDir()
  const file = path.join(dir, 'settings.json')
  await fs.writeFile(file, JSON.stringify({ token: 'super-secret-value', glmPlatform: 'zai', password: 'hunter2-secret' }))
  const settings = createSettingsStore(dir)
  assert.equal(settings.get().glmPlatform, 'zai')
  assert.equal(settings.get().glmKeyStored, false)
  const text = await fs.readFile(file, 'utf8')
  assert.equal(text.includes('super-secret-value'), false)
  assert.equal(text.includes('hunter2-secret'), false)
  await fs.rm(dir, { recursive: true, force: true })
})

test('footer renders five groups and the dialog lists the tool window separately', () => {
  const display = toDisplay({
    glmPlatform: 'zhipu',
    liveReads: false,
    byId: {
      codex: {
        status: 'fresh',
        updatedAt: 1_700_000_000_000,
        source: 'codex account/rateLimits/read',
        windows: [
          { label: '短', scope: 'model', durationMs: 5 * hour, usedRatio: 0.25 },
          { label: '长', scope: 'model', durationMs: 7 * 24 * hour, usedRatio: 0.5 },
          { label: 'MCP', scope: 'tool', durationMs: null, usedRatio: 0.5, quantity: 3, limit: 10 },
        ],
      },
      claude: { status: 'unknown', experimental: true, windows: [] },
      opencode: { status: 'unknown', experimental: true, windows: [] },
      grok: { status: 'unread', windows: [], link: { href: 'https://grok.com', label: 'Grok 官网' } },
      glm: { status: 'unknown', windows: [] },
    },
  })
  const footer = footerElement(react(), { model: display, wide: true })
  const providers = []
  walk(footer, (node) => { if (node.props?.['data-provider']) providers.push(node.props['data-provider']) })
  assert.deepEqual(providers, ['codex', 'claude', 'opencode', 'grok', 'glm'])
  const fractions = []
  walk(footer, (node) => { if (node.props?.['data-provider'] === 'codex') {
    walk(node, (child) => { if (child.props?.['data-fraction']) fractions.push(child.props['data-fraction']) })
  } })
  assert.deepEqual(fractions, ['0.75', '0.5'])
  const dialog = dialogElement(react(), { model: display, providerId: 'codex' })
  const text = JSON.stringify(dialog)
  assert.match(text, /工具（月额度）/)
  assert.match(text, /3\/10/)
  const unknown = dialogElement(react(), { model: display, providerId: 'claude' })
  assert.equal(JSON.stringify(unknown).includes('0%'), false)
  assert.equal(JSON.stringify(unknown).includes('100%'), false)
  const titles = []
  walk(footer, (node) => { if (node.props?.['data-provider'] === 'codex') titles.push(node.props.title) })
  assert.equal(titles[0], undefined)
  const labels = []
  walk(footer, (node) => {
    if (node.props?.['aria-label']) labels.push(node.props['aria-label'])
  })
  assert.equal(labels.some((item) => /5小时/.test(item) && /75%/.test(item)), true)
  assert.equal(labels.some((item) => /1周/.test(item)), true)
  assert.match(text, /codex account\/rateLimits\/read/)
  const hovered = footerElement(react(), { model: display, wide: true, hoverId: 'codex' })
  const card = []
  walk(hovered, (node) => { if (node.props?.['data-hover-card'] === 'codex') card.push(node) })
  assert.equal(card.length, 1)
  const cardText = JSON.stringify(card[0])
  assert.match(cardText, /工具（月额度）/)
  assert.match(cardText, /3\/10/)
  assert.match(cardText, /短/)
  assert.match(cardText, /长/)
  const remainings = []
  walk(card[0], (node) => { if (node.props?.['data-remaining'] != null) remainings.push(node.props['data-remaining']) })
  assert.deepEqual(remainings, ['75%', '50%', '50%'])
  assert.equal(remainings.includes('100%'), false)
  assert.equal(remainings.includes('80%'), false)
  assert.equal(remainings.includes('14%'), false)
})

test('disabling one provider aborts that request and a late success cannot restore a fraction', async () => {
  let phase = 'seed'
  let signal
  let finish
  const box = harness({
    queries: {
      codex: ({ signal: next }) => {
        if (phase === 'seed') {
          return {
            ok: true,
            windows: [{ label: '短', scope: 'model', durationMs: 5 * hour, usedRatio: 0.25 }],
          }
        }
        return new Promise((resolve) => {
          signal = next
          finish = resolve
        })
      },
    },
  })
  await box.service.refreshOne('codex')
  phase = 'hang'
  const pending = box.service.refreshOne('codex')
  assert.equal(signal.aborted, false)
  await box.service.setDisabled('codex', true)
  assert.equal(signal.aborted, true)
  finish({
    ok: true,
    windows: [{ label: '晚到', scope: 'model', durationMs: 5 * hour, usedRatio: 0.1 }],
  })
  await pending
  const row = box.service.snapshot().byId.codex
  assert.equal(row.status, 'disabled')
  assert.equal(row.windows[0].label, '短')
  assert.equal(row.windows.some((item) => item.label === '晚到'), false)
  const shown = toDisplay(box.service.snapshot()).rows.find((item) => item.id === 'codex')
  assert.equal(shown.rings[0].fraction, null)
  assert.equal(shown.rings[0].caption, '已停用')
  assert.equal(shown.windows[0].remainingText, '未知')
})

test('enable clears disabled and waits for the new read', async () => {
  let calls = 0
  const box = harness({
    queries: {
      claude: () => {
        calls += 1
        return {
          ok: true,
          experimental: true,
          windows: [{ label: 'Claude', scope: 'model', durationMs: 5 * hour, usedRatio: 0.2 }],
        }
      },
    },
  })
  await box.service.setDisabled('claude', true)
  assert.equal(calls, 0)
  assert.equal(box.settings.get().disabled.claude, true)
  assert.equal(box.service.snapshot().byId.claude.status, 'disabled')
  await box.service.setDisabled('claude', false)
  assert.equal(calls, 1)
  assert.equal(box.settings.get().disabled.claude, undefined)
  assert.equal(box.service.snapshot().byId.claude.status, 'fresh')
  assert.equal(toDisplay(box.service.snapshot()).rows.find((row) => row.id === 'claude').rings[0].fraction, 0.8)
})

test('an incomplete result keeps the previous windows and marks them stale', async () => {
  let complete = true
  const box = harness({
    queries: {
      glm: () => (complete
        ? {
          ok: true,
          windows: [{ label: 'Token 用量（5 小时）', scope: 'model', durationMs: 5 * hour, usedRatio: 0.3 }],
          source: 'GET /api/monitor/usage/quota/limit',
        }
        : { ok: false, incomplete: true, code: 'incomplete', message: '额度响应缺少 limits，已保留上次结果。' }),
    },
  })
  await box.service.refreshOne('glm')
  const freshAt = box.service.snapshot().byId.glm.updatedAt
  complete = false
  await box.service.refreshOne('glm')
  const stale = box.service.snapshot().byId.glm
  assert.equal(stale.status, 'stale')
  assert.equal(stale.updatedAt, freshAt)
  assert.equal(stale.windows[0].usedRatio, 0.3)
  assert.match(stale.error, /缺少 limits/)
})

test('a thrown provider error is stored without the current fixture secret', async () => {
  const secret = 'fixture-bearer-token'
  const box = harness({
    queries: {
      glm: () => {
        const error = new Error(`transport failed Bearer ${secret} and tool -p ${secret}`)
        error.redactSecrets = [secret]
        throw error
      },
    },
  })
  await box.service.refreshOne('glm')
  const row = box.service.snapshot().byId.glm
  const text = JSON.stringify(box.service.snapshot())
  assert.equal(text.includes(secret), false)
  assert.equal(Object.hasOwn(row, 'redactSecrets'), false)
  assert.match(row.error, /Bearer \[redacted\]/)
  assert.match(row.error, /-p\[redacted\]/)
})

test('resume during a batch schedules one follow-up refresh', async () => {
  let release
  let codexCalls = 0
  const box = harness({
    queries: {
      codex: () => {
        codexCalls += 1
        if (codexCalls === 1) {
          return new Promise((resolve) => {
            release = () => resolve({ ok: true, windows: [] })
          })
        }
        return { ok: true, windows: [] }
      },
    },
  })
  const pending = box.service.start()
  assert.equal(codexCalls, 1)
  box.service.pause()
  box.service.resume()
  assert.equal(codexCalls, 1)
  release()
  await pending
  assert.equal(codexCalls, 2)
  box.service.dispose()
})

test('an injected power monitor pauses and resumes the scheduler', async () => {
  const box = harness()
  await box.service.start()
  const monitor = new EventEmitter()
  const unbind = bindPowerMonitor(monitor, box.service)
  assert.equal(box.timers.length, 1)
  monitor.emit('suspend')
  assert.equal(box.timers.length, 0)
  const before = box.calls.length
  monitor.emit('resume')
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(box.calls.length > before)
  assert.equal(box.timers.length, 1)
  unbind()
  monitor.emit('suspend')
  assert.equal(box.timers.length, 1)
  const host = new Map()
  const ctx = {
    on(name, fn) {
      host.set(name, fn)
      return () => host.delete(name)
    },
  }
  const unbindHost = bindHostPower(ctx, box.service)
  assert.equal(host.has('dsh/power'), true)
  host.get('dsh/power')('suspend')
  assert.equal(box.timers.length, 0)
  host.get('dsh/power')('resume')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(box.timers.length, 1)
  unbindHost()
  assert.equal(host.has('dsh/power'), false)
  box.service.dispose()
  assert.equal(box.timers.length, 0)
})

test('OpenCode Go uses its own keychain account and a non-secret settings flag', async () => {
  const saved = []
  const settings = {
    state: { disabled: {}, glmPlatform: 'zhipu', liveReads: false, glmKeyStored: false, opencodeKeyStored: false },
    get() { return this.state },
    save(patch) { this.state = { ...this.state, ...patch, disabled: patch.disabled ?? this.state.disabled } },
  }
  const service = createQuotaService({
    settings,
    secrets: {
      set(account, secret) { saved.push({ account, secret }); return Promise.resolve({ ok: true }) },
    },
    queries: {},
  })
  const result = await service.storeOpenCodeToken('fixture-opencode-secret')
  assert.equal(result.ok, true)
  assert.deepEqual(saved, [{ account: 'opencode', secret: 'fixture-opencode-secret' }])
  assert.equal(settings.get().opencodeKeyStored, true)
  const snapshot = service.snapshot()
  assert.equal(snapshot.opencodeKeyStored, true)
  assert.equal(JSON.stringify(snapshot).includes('fixture-opencode-secret'), false)
})
