import { PROVIDERS } from './model.js'

// Route ids are the DSH LLM adapter/provider keys (for example `opencode-go`,
// `openai-codex`, `anthropic`). A quota provider is shown only when the host
// actually has a matching model route configured. The same patterns pick the
// host credential record for a provider, so both decisions agree.
export const ROUTE_PATTERNS = {
  codex: /codex/i,
  claude: /anthropic|claude/i,
  opencode: /opencode/i,
  glm: /zhipu|bigmodel|z-?ai|\bglm\b/i,
  grok: /grok|\bxai\b/i,
}

function readService(ctx, name) {
  try {
    if (typeof ctx?.get === 'function') return ctx.get(name, false) ?? null
    return ctx?.[name] ?? null
  } catch {
    return null
  }
}

/**
 * Which quota providers the host has model routes for.
 * Returns null when the LLM registry cannot be read, so callers fall back to
 * showing every provider instead of silently hiding all of them.
 */
export function detectProviders(ctx) {
  const llm = readService(ctx, 'llm')
  if (!llm || typeof llm.listProviders !== 'function') return null
  let list
  try {
    list = llm.listProviders()
  } catch {
    return null
  }
  if (!Array.isArray(list)) return null
  const routes = list.map((item) => String(item?.id ?? '').trim()).filter(Boolean)
  const providers = PROVIDERS.filter((id) => {
    const pattern = ROUTE_PATTERNS[id]
    return pattern ? routes.some((route) => pattern.test(route)) : true
  })
  return { routes: [...new Set(routes)], providers }
}
