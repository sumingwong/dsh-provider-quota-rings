export const PROVIDERS = Object.freeze(['codex', 'claude', 'opencode', 'grok', 'glm'])

export const PROVIDER_LABELS = Object.freeze({
  codex: 'Codex',
  claude: 'Claude',
  opencode: 'OpenCode Go',
  grok: 'Grok',
  glm: 'GLM',
})

function unit(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

/** Remaining share in [0, 1]. Missing data stays null, never 0 or 1. */
export function remainingFraction(window) {
  if (!window || typeof window !== 'object') return null
  if (unit(window.remainingRatio)) return window.remainingRatio
  if (unit(window.usedRatio)) return 1 - window.usedRatio
  const remaining = window.remaining
  const limit = window.limit
  if (typeof remaining === 'number' && typeof limit === 'number'
    && Number.isFinite(remaining) && Number.isFinite(limit)
    && limit > 0 && remaining >= 0) {
    return Math.min(1, remaining / limit)
  }
  return null
}

export function durationCaption(durationMs) {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) return '未知'
  const minutes = durationMs / 60000
  if (minutes % (60 * 24 * 7) === 0) return `${minutes / (60 * 24 * 7)}周`
  if (minutes % (60 * 24) === 0) return `${minutes / (60 * 24)}天`
  if (minutes % 60 === 0) return `${minutes / 60}小时`
  if (Number.isInteger(minutes)) return `${minutes}分钟`
  return `${Math.round(minutes)}分钟`
}

/**
 * At most two model rings: the shortest and longest known windows.
 * One window, or equal durations, produces one ring. Tool, credit and unknown scopes stay out.
 */
export function selectRings(windows) {
  const ranked = []
  for (const window of windows ?? []) {
    if (!window || window.scope !== 'model') continue
    if (remainingFraction(window) == null) continue
    if (typeof window.durationMs !== 'number' || !Number.isFinite(window.durationMs) || window.durationMs <= 0) continue
    ranked.push(window)
  }
  ranked.sort((a, b) => a.durationMs - b.durationMs || String(a.label).localeCompare(String(b.label)))
  if (ranked.length === 0) return []
  const shortest = ranked[0]
  const longest = ranked[ranked.length - 1]
  const chosen = shortest.durationMs === longest.durationMs ? [shortest] : [shortest, longest]
  return chosen.map((window) => ({
    fraction: remainingFraction(window),
    caption: durationCaption(window.durationMs),
    title: window.label ?? durationCaption(window.durationMs),
    durationMs: window.durationMs,
  }))
}
