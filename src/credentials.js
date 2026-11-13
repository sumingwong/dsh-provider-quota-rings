/**
 * Read the key the host already holds for a model route, so a provider the user
 * configured for chatting does not need a second copy pasted into this plugin.
 *
 * Two host shapes exist for an LLM route's key:
 *  - a credential *reference*, an environment-variable style name the route
 *    profile points at (`apiKeyEnv: OPENCODE_GO_API_KEY`). `credentials.resolve`
 *    reads the managed store, then the inherited environment, then `.env`.
 *  - a credential *record* the Models page writes, addressed as
 *    `llm-pi-ai/<route id>` and typed `api-key`.
 *
 * Both are read here, references first because that is what a chat route with
 * `apiKeyEnv` uses. Nothing is logged: a value goes straight to the quota
 * request that needs it.
 */

export const HOST_CREDENTIAL_SCOPE = 'llm-pi-ai'
const SCOPE_PREFIX = `${HOST_CREDENTIAL_SCOPE}/`

/** Reference name the host derives for a route id, e.g. `OPENCODE_GO_API_KEY`. */
export function referenceForRoute(routeId) {
  const stem = String(routeId ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return stem.length > 0 ? `${stem}_API_KEY` : null
}

/** Conventional reference names, tried after the route-derived one. */
export const REFERENCE_ALIASES = Object.freeze({
  opencode: ['OPENCODE_API_KEY', 'OPENCODE_ZEN_API_KEY'],
  glm: ['ZHIPUAI_API_KEY', 'ZHIPU_API_KEY', 'GLM_API_KEY', 'ZAI_API_KEY', 'BIGMODEL_API_KEY'],
  codex: ['OPENAI_API_KEY'],
  claude: ['ANTHROPIC_API_KEY'],
  grok: ['XAI_API_KEY', 'GROK_API_KEY'],
})

/** Every reference worth asking for, most specific first. */
export function referenceCandidates(provider, routes) {
  const names = []
  for (const route of Array.isArray(routes) ? routes : []) {
    const derived = referenceForRoute(route)
    if (derived && !names.includes(derived)) names.push(derived)
  }
  for (const alias of REFERENCE_ALIASES[provider] ?? []) {
    if (!names.includes(alias)) names.push(alias)
  }
  return names
}

/** Credential key for one route id, e.g. `llm-pi-ai/opencode-go`. */
export function hostCredentialKey(routeId) {
  return `${SCOPE_PREFIX}${routeId}`
}

/**
 * First stored record in the host's LLM scope whose route id matches `pattern`.
 * Accepts the entries `credentials.listRecords()` returns: `{ key, kind }`.
 */
export function pickHostRecordKey(entries, pattern) {
  if (!Array.isArray(entries) || !pattern) return null
  for (const entry of entries) {
    if (entry?.kind !== 'api-key') continue
    const key = String(entry.key ?? '')
    if (!key.startsWith(SCOPE_PREFIX)) continue
    if (pattern.test(key.slice(SCOPE_PREFIX.length))) return key
  }
  return null
}

/**
 * The secret out of one stored record. A record carrying no key falls back to
 * its provider environment values, which is how a route may hold a rotated key.
 */
export function secretFromRecord(record) {
  if (!record || record.kind !== 'api-key') return null
  if (typeof record.key === 'string' && record.key.length > 0) return record.key
  const env = record.env
  if (env && typeof env === 'object') {
    for (const value of Object.values(env)) {
      if (typeof value === 'string' && value.length > 0) return value
    }
  }
  return null
}

function valueOf(hit) {
  if (typeof hit === 'string') return hit
  if (hit && typeof hit.value === 'string' && hit.value.length > 0) return hit.value
  return null
}

/**
 * Lookup bound to the host context. Every failure is swallowed into `null`:
 * a missing or unreadable credential store must never break the quota refresh,
 * it only means "no key from the host".
 */
export function createHostCredentials(ctx, { routes = () => [] } = {}) {
  function service() {
    try {
      if (typeof ctx?.get === 'function') return ctx.get('credentials', false) ?? null
      return ctx?.credentials ?? null
    } catch {
      return null
    }
  }

  function routeList() {
    try {
      const list = routes()
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  }

  return {
    /** The secret the host holds for `provider`, or null. */
    async find({ provider, pattern } = {}) {
      const credentials = service()
      if (!credentials) return null
      const matched = routeList().filter((route) => (pattern ? pattern.test(route) : true))

      if (typeof credentials.resolve === 'function') {
        for (const ref of referenceCandidates(provider, matched)) {
          try {
            const found = valueOf(await credentials.resolve(ref))
            if (found) return found
          } catch { /* a reference that cannot resolve is simply absent */ }
        }
      }

      if (typeof credentials.listRecords !== 'function' || typeof credentials.readRecord !== 'function') return null
      let entries
      try {
        entries = await credentials.listRecords()
      } catch {
        return null
      }
      const storedKey = pickHostRecordKey(entries, pattern)
      if (!storedKey) return null
      try {
        return secretFromRecord(await credentials.readRecord(storedKey))
      } catch {
        return null
      }
    },
  }
}
