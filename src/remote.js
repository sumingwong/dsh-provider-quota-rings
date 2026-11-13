import { toDisplay } from './display.js'
import { isSecretKey, redactText } from './redact.js'

/** Prototype key read by the host gateway's SRC fallback. Not a generated registry entry. */
export const REMOTE_METHOD_MARKER = '@deepseek-ai/dsh-typert-protocol/remote-methods'

export const QUOTA_REMOTE_PACKAGE = 'dsh-provider-quota-rings'
export const QUOTA_REMOTE_SERVICE = 'quotaRings'
export const QUOTA_REMOTE_NAMESPACE = 'quotaRings'

/** Endpoint ids shared with the sidebar client. The client cannot import this module. */
export const QUOTA_REMOTE_IDS = Object.freeze({
  read: 'dsh-provider-quota-rings#quotaRings/read',
  refresh: 'dsh-provider-quota-rings#quotaRings/refresh',
  setDisabled: 'dsh-provider-quota-rings#quotaRings/setDisabled',
  setPlatform: 'dsh-provider-quota-rings#quotaRings/setPlatform',
  storeGlmKey: 'dsh-provider-quota-rings#quotaRings/storeGlmKey',
  storeOpenCodeKey: 'dsh-provider-quota-rings#quotaRings/storeOpenCodeKey',
  setLiveReads: 'dsh-provider-quota-rings#quotaRings/setLiveReads',
})

const EXTRA_SECRET_KEYS = new Set([
  'secret', 'token', 'password', 'authorization', 'apikey', 'glmkey', 'opencodekey', 'cookie', 'key', 'raw',
])

export function stripSecrets(value) {
  if (Array.isArray(value)) return value.map((item) => stripSecrets(item))
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    const lower = String(key).toLowerCase()
    if (isSecretKey(key) || EXTRA_SECRET_KEYS.has(lower)) continue
    out[key] = stripSecrets(item)
  }
  return out
}

export function publicSnapshot(snapshot, now = Date.now()) {
  return stripSecrets(toDisplay(snapshot, now))
}

function marker(methods) {
  return Object.freeze({
    version: 1,
    methods: Object.freeze(methods.map((method) => Object.freeze({
      method,
      invocation: Object.freeze({ kind: 'direct' }),
    }))),
  })
}

/**
 * Session-free quota surface. Methods take no session id.
 * The last parameter is named signal so the host SRC fallback treats it as cancellation.
 */
export class QuotaRingsRemote {
  constructor(service, now = Date.now) {
    this.service = service
    this.now = now
    this.typertRemote = Object.freeze({
      service: this,
      serviceKey: QUOTA_REMOTE_SERVICE,
      namespace: QUOTA_REMOTE_NAMESPACE,
    })
  }

  read(signal) {
    signal?.throwIfAborted?.()
    return publicSnapshot(this.service.snapshot(), this.now())
  }

  async refresh(providerId, signal) {
    signal?.throwIfAborted?.()
    const id = typeof providerId === 'string' ? providerId : ''
    if (id) await this.service.refreshOne(id)
    else await this.service.refreshAll()
    return publicSnapshot(this.service.snapshot(), this.now())
  }

  async setDisabled(providerId, disabled, signal) {
    signal?.throwIfAborted?.()
    await this.service.setDisabled(providerId, disabled === true)
    return publicSnapshot(this.service.snapshot(), this.now())
  }

  setPlatform(platform, signal) {
    signal?.throwIfAborted?.()
    this.service.setGlmPlatform(platform)
    return publicSnapshot(this.service.snapshot(), this.now())
  }

  async setLiveReads(enabled, signal) {
    signal?.throwIfAborted?.()
    await this.service.setLiveReads(enabled === true)
    return publicSnapshot(this.service.snapshot(), this.now())
  }

  async storeGlmKey(secret, signal) {
    signal?.throwIfAborted?.()
    const value = typeof secret === 'string' ? secret : ''
    if (!value) {
      return { ok: false, message: '没有收到密钥。请用详情里的密码框，不要把密钥发给模型。' }
    }
    const saved = await this.service.storeGlmToken(value)
    if (!saved?.ok) {
      return {
        ok: false,
        message: redactText(saved?.message || '钥匙串没有保存密钥。', [value]).slice(0, 160),
      }
    }
    return { ok: true, message: 'GLM 密钥已写入本机钥匙串。对话和这条结果都不会显示密钥。' }
  }

  async storeOpenCodeKey(secret, signal) {
    signal?.throwIfAborted?.()
    const value = typeof secret === 'string' ? secret : ''
    if (!value) {
      return { ok: false, message: '没有收到密钥。请用详情里的密码框，不要把密钥发给模型。' }
    }
    const saved = await this.service.storeOpenCodeToken(value)
    if (!saved?.ok) {
      return {
        ok: false,
        message: redactText(saved?.message || '钥匙串没有保存密钥。', [value]).slice(0, 160),
      }
    }
    return { ok: true, message: 'OpenCode Go 密钥已写入本机钥匙串。对话和这条结果都不会显示密钥。' }
  }
}

Object.defineProperty(QuotaRingsRemote.prototype, REMOTE_METHOD_MARKER, {
  configurable: true,
  value: marker(['read', 'refresh', 'setDisabled', 'setPlatform', 'storeGlmKey', 'storeOpenCodeKey', 'setLiveReads']),
})

/**
 * Register the remote on the host context when Cordis reflect is present.
 * Does not call commands.execute and does not import the Typert generator.
 */
export function registerQuotaRemote(ctx, service, now) {
  const remote = new QuotaRingsRemote(service, now)
  let dispose = () => {}
  if (typeof ctx?.reflect?.provide === 'function') {
    const result = ctx.reflect.provide(QUOTA_REMOTE_SERVICE, remote)
    if (typeof result === 'function') dispose = result
  }
  return { remote, dispose }
}
