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
 * `apiKeyEnv` uses. A reference is tried under the names a route id derives,
 * then under the aliases a provider is usually spelled with, then under any
 * stored name that claims the provider — so renaming `apiKeyEnv` in the host
 * profile does not silently drop the key. Nothing is logged: a value goes
 * straight to the quota request that needs it.
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

/** Words that say nothing about which service a reference belongs to. */
const NAME_NOISE = new Set(['API', 'KEY', 'KEYS', 'TOKEN', 'SECRET', 'ENV', 'VAR', 'VALUE', 'OAUTH'])

function tokensOf(text) {
  return String(text ?? '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length > 1 && !NAME_NOISE.has(token))
}

/**
 * Words that identify a provider inside a reference name: its own name plus the
 * stems of its known aliases, so `ZHIPUAI_API_KEY` counts for `glm`.
 */
export function providerWords(provider) {
  const words = new Set(tokensOf(provider).map((token) => token.toLowerCase()))
  for (const alias of REFERENCE_ALIASES[provider] ?? []) {
    for (const token of tokensOf(alias)) words.add(token.toLowerCase())
  }
  return words
}

/**
 * How strongly a stored reference name claims `provider`. Zero unless the name
 * carries a provider word, which is what keeps `GOOGLE_GO_KEY` out of the
 * OpenCode lookup; route words only break ties between provider names.
 */
export function scoreReference(name, { provider, routes = [] } = {}) {
  const words = providerWords(provider)
  const routeTokens = new Set()
  for (const route of Array.isArray(routes) ? routes : []) {
    for (const token of tokensOf(route)) routeTokens.add(token.toLowerCase())
  }
  let score = 0
  let claimed = false
  for (const token of tokensOf(name)) {
    const word = token.toLowerCase()
    if (words.has(word)) {
      score += 3
      claimed = true
    }
    if (routeTokens.has(word)) score += 2
  }
  return claimed ? score : 0
}

/** Stored names ranked for `provider`, best first; ties break on the shorter name. */
export function rankReferenceNames(names, context = {}) {
  const scored = []
  for (const name of Array.isArray(names) ? names : []) {
    if (typeof name !== 'string' || name.length === 0) continue
    const score = scoreReference(name, context)
    if (score > 0) scored.push({ name, score })
  }
  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    if (left.name.length !== right.name.length) return left.name.length - right.name.length
    return left.name < right.name ? -1 : 1
  })
  return scored.map((entry) => entry.name)
}

/** Reference names that carry something other than a Bearer API key. */
const NOT_API_KEY = /_(?:OAUTH|REFRESH|ID)_TOKEN$|_SECRET$|_PASSWORD$|_PRIVATE_KEY$/

/**
 * Names the host currently stores. The credential service cannot list them, so
 * this reads the provider's in-memory snapshot (a `Map` of reference to value)
 * and keeps only its keys; any other shape, or one whose iteration throws,
 * means "unknown", never an error.
 */
export function storedReferenceNames(credentials) {
  try {
    const values = credentials?.values
    if (!values || typeof values.keys !== 'function') return []
    const names = []
    for (const name of values.keys()) {
      if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(name)) continue
      if (NOT_API_KEY.test(name.toUpperCase())) continue
      names.push(name)
      if (names.length >= 200) break
    }
    return names
  } catch {
    return []
  }
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
        const attempted = new Set()
        for (const ref of referenceCandidates(provider, matched)) {
          attempted.add(ref)
          try {
            const found = valueOf(await credentials.resolve(ref))
            if (found) return found
          } catch { /* a reference that cannot resolve is simply absent */ }
        }

        /* Names the host stores under a spelling no route id derives, e.g. one
           the user typed by hand. Only the best few are asked for. */
        const fuzzy = rankReferenceNames(storedReferenceNames(credentials), { provider, routes: matched })
        for (const ref of fuzzy.slice(0, 3)) {
          if (attempted.has(ref)) continue
          try {
            const found = valueOf(await credentials.resolve(ref))
            if (found) return found
          } catch { /* same as above */ }
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
