import { PROVIDERS } from './model.js'
import { limitPublicText, redactText } from './redact.js'
import { DEFAULT_INTERVAL_MS, createScheduler } from './scheduler.js'
import { GLM_ACCOUNT, OPENCODE_ACCOUNT } from './secrets.js'

function blank(provider) {
  return {
    provider,
    status: 'unknown',
    windows: [],
    updatedAt: null,
    error: null,
    code: null,
    stale: false,
    experimental: provider === 'claude' || provider === 'opencode',
    source: null,
    note: null,
    link: null,
    message: null,
    retryAfterUntil: null,
    platform: null,
  }
}

function failureMessage(result) {
  const secrets = Array.isArray(result?.redactSecrets) ? result.redactSecrets : []
  const text = redactText(result?.message ?? '查询失败', secrets)
  return limitPublicText(text)
}

export function createQuotaService({
  settings,
  secrets,
  queries,
  detect = () => null,
  now = () => Date.now(),
  intervalMs = DEFAULT_INTERVAL_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (!settings || !queries) throw new Error('quota service needs settings and queries')
  const cache = new Map()
  const inflight = new Map()
  let batch = null
  let again = false
  let disposed = false
  let started = false

  function detected() {
    try {
      return detect() ?? null
    } catch {
      return null
    }
  }

  function visible() {
    const found = detected()
    if (!found || !Array.isArray(found.providers)) return [...PROVIDERS]
    return PROVIDERS.filter((id) => found.providers.includes(id))
  }

  function platform() {
    return settings.get().glmPlatform
  }

  function keyFor(provider, glmPlatform = platform()) {
    return provider === 'glm' ? `glm:${glmPlatform}` : provider
  }

  function remember(key, provider, glmPlatform, result) {
    const previous = cache.get(key) ?? blank(provider)
    if (result?.unread) {
      cache.set(key, {
        ...blank(provider),
        status: 'unread',
        link: result.link ?? null,
        message: result.message ?? '暂无法读取',
        platform: glmPlatform,
      })
      return
    }
    const failed = !result?.ok || result?.incomplete === true
    if (failed) {
      const retryAfterUntil = typeof result?.retryAfterMs === 'number'
        ? now() + result.retryAfterMs
        : previous.retryAfterUntil
      const message = failureMessage(result)
      if (previous.status === 'fresh' || previous.status === 'stale' || previous.windows.length > 0) {
        cache.set(key, {
          ...previous,
          status: 'stale',
          stale: true,
          error: message,
          code: result?.code ?? 'error',
          retryAfterUntil,
          platform: glmPlatform,
        })
        return
      }
      cache.set(key, {
        ...blank(provider),
        status: 'unknown',
        error: message,
        code: result?.code ?? 'error',
        experimental: result?.experimental === true || previous.experimental === true,
        retryAfterUntil,
        platform: glmPlatform,
      })
      return
    }
    const windows = Array.isArray(result.windows) ? result.windows : []
    if (windows.length === 0 && result.emptyIsFailure === true) {
      remember(key, provider, glmPlatform, {
        ok: false,
        code: 'incomplete',
        message: result.message || '额度响应不完整，已保留上次结果。',
      })
      return
    }
    cache.set(key, {
      ...blank(provider),
      status: 'fresh',
      windows,
      updatedAt: now(),
      source: result.source ?? null,
      note: result.note ?? null,
      experimental: result.experimental === true,
      platform: glmPlatform,
    })
  }

  function abortProvider(provider) {
    inflight.get(keyFor(provider))?.controller.abort()
  }

  async function refreshOne(provider) {
    if (disposed) return
    if (!PROVIDERS.includes(provider)) throw new Error('未知服务商')
    const glmPlatform = platform()
    const key = keyFor(provider, glmPlatform)
    if (settings.get().disabled[provider] === true) {
      const previous = cache.get(key) ?? blank(provider)
      cache.set(key, { ...previous, provider, status: 'disabled', platform: glmPlatform, error: null })
      return
    }
    const current = cache.get(key)
    if (current?.retryAfterUntil != null && now() < current.retryAfterUntil) return
    const pending = inflight.get(key)
    if (pending) return pending.job
    const controller = new AbortController()
    const job = (async () => {
      try {
        const result = await queries[provider]({
          signal: controller.signal,
          platform: glmPlatform,
          liveReads: settings.get().liveReads === true,
        })
        if (disposed || controller.signal.aborted) return
        if (settings.get().disabled[provider] === true) return
        remember(key, provider, glmPlatform, result)
      } catch (error) {
        if (disposed || controller.signal.aborted) return
        if (settings.get().disabled[provider] === true) return
        remember(key, provider, glmPlatform, {
          ok: false,
          code: 'error',
          message: error instanceof Error ? error.message : '查询失败',
          redactSecrets: error?.redactSecrets,
        })
      } finally {
        inflight.delete(key)
      }
    })()
    inflight.set(key, { controller, job })
    return job
  }

  function refreshAll() {
    if (disposed) return Promise.resolve()
    if (batch) return batch
    batch = Promise.all(visible().map((id) => refreshOne(id))).finally(() => {
      batch = null
      if (again && !disposed) {
        again = false
        return refreshAll()
      }
      return undefined
    })
    return batch
  }

  const scheduler = createScheduler({
    intervalMs,
    now,
    setTimer,
    clearTimer,
    onFire(info) {
      if (batch && (info?.resume === true || info?.late === true)) {
        again = true
        return batch
      }
      return refreshAll()
    },
  })

  function snapshot() {
    const current = settings.get()
    const byId = {}
    for (const id of PROVIDERS) {
      const stored = cache.get(keyFor(id, current.glmPlatform))
      byId[id] = stored ? { ...stored, windows: stored.windows.map((item) => ({ ...item })) } : blank(id)
    }
    const found = detected()
    return {
      exampleData: false,
      detected: found ? { routes: [...found.routes], providers: visible() } : null,
      visible: visible(),
      glmPlatform: current.glmPlatform,
      glmKeyStored: current.glmKeyStored === true,
      opencodeKeyStored: current.opencodeKeyStored === true,
      liveReads: current.liveReads === true,
      byId,
    }
  }

  return {
    start() {
      if (started || disposed) return Promise.resolve()
      started = true
      scheduler.start()
      return refreshAll()
    },
    pause() { scheduler.pause() },
    resume() { scheduler.resume() },
    refreshAll,
    refreshOne,
    snapshot,
    async setDisabled(id, disabled) {
      if (!PROVIDERS.includes(id)) throw new Error('未知服务商')
      const next = { ...settings.get().disabled }
      if (disabled) next[id] = true
      else delete next[id]
      settings.save({ disabled: next })
      const key = keyFor(id)
      const previous = cache.get(key) ?? blank(id)
      if (disabled) {
        abortProvider(id)
        cache.set(key, { ...previous, status: 'disabled', error: null })
        return
      }
      cache.set(key, {
        ...previous,
        status: previous.windows.length > 0 ? 'stale' : 'unknown',
        error: null,
      })
      await refreshOne(id)
    },
    setGlmPlatform(next) {
      if (next !== 'zhipu' && next !== 'zai') throw new Error('平台只能是 zhipu 或 zai')
      settings.save({ glmPlatform: next })
    },
    /**
     * Authorization gate for live reads. Turning it on drops cached rows so the
     * next pass reports what the real queries say; turning it off drops them too,
     * because carrying numbers around after the user revoked the grant would lie.
     */
    async setLiveReads(enabled) {
      if (disposed) return
      const next = enabled === true
      if (settings.get().liveReads === next) return
      settings.save({ liveReads: next })
      for (const id of PROVIDERS) {
        const key = keyFor(id)
        const stored = cache.get(key)
        if (!stored || stored.status === 'disabled') continue
        cache.set(key, { ...blank(id), platform: stored.platform ?? platform() })
      }
      await refreshAll()
    },
    async storeGlmToken(secret) {
      if (!secrets) return { ok: false, message: '没有密钥存储。' }
      const saved = await secrets.set(GLM_ACCOUNT, secret)
      if (!saved?.ok) return { ok: false, message: saved?.message || '钥匙串没有保存密钥。' }
      settings.save({ glmKeyStored: true })
      return { ok: true }
    },
    async storeOpenCodeToken(secret) {
      if (!secrets) return { ok: false, message: '没有密钥存储。' }
      const saved = await secrets.set(OPENCODE_ACCOUNT, secret)
      if (!saved?.ok) return { ok: false, message: saved?.message || '钥匙串没有保存密钥。' }
      settings.save({ opencodeKeyStored: true })
      return { ok: true }
    },
    dispose() {
      if (disposed) return
      disposed = true
      again = false
      scheduler.dispose()
      for (const entry of inflight.values()) entry.controller.abort()
      inflight.clear()
      batch = null
    },
  }
}
