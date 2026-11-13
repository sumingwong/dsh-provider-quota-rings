import { assertSafeHeaders } from '../http.js'
import { redactText } from '../redact.js'

/** Hosts accepted by zai-org/zai-coding-plugins query-usage.mjs at 0446d0bb0bc537d97d3ab3664c4b8b9c4a0e1254. */
export const GLM_HOSTS = Object.freeze({
  zhipu: 'open.bigmodel.cn',
  zai: 'api.z.ai',
})

export const GLM_ALLOWED_HOSTS = Object.freeze(new Set(['open.bigmodel.cn', 'api.z.ai']))

const QUOTA_PATH = '/api/monitor/usage/quota/limit'
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000
export const CONSERVATIVE_RETRY_MS = 15 * 60 * 1000

export function glmQuotaUrl(platform) {
  const host = GLM_HOSTS[platform]
  if (!host) {
    const error = new Error('平台只能是 zhipu 或 zai')
    error.code = 'bad-platform'
    throw error
  }
  return `https://${host}${QUOTA_PATH}`
}

export function assertGlmUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !GLM_ALLOWED_HOSTS.has(url.hostname) || url.pathname !== QUOTA_PATH || url.search) {
    const error = new Error('GLM 额度地址不在允许名单内')
    error.code = 'glm-host-rejected'
    throw error
  }
  return url
}

function usedRatio(percentage) {
  return typeof percentage === 'number' && Number.isFinite(percentage) && percentage >= 0 && percentage <= 100
    ? percentage / 100
    : null
}

const DATE_MAX_MS = 8_640_000_000_000_000

function legacyResetsAtMs(item) {
  const value = item?.resetsAt ?? item?.resetAt ?? item?.resetTime
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value < 1e12 ? value * 1000 : value
}

function creditResetsAtMs(item) {
  const next = item?.nextResetTime
  if (typeof next === 'number' && Number.isFinite(next) && next >= 1e12 && next <= DATE_MAX_MS) return next
  return legacyResetsAtMs(item)
}

function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function oneLimit(item, index) {
  const type = item?.type
  const ratio = usedRatio(item?.percentage)
  if (type === 'TOKENS_LIMIT' || type === 'Token usage(5 Hour)') {
    return {
      id: `glm-tokens-${index}`,
      label: 'Token 用量（5 小时）',
      scope: 'model',
      durationMs: FIVE_HOURS_MS,
      usedRatio: ratio,
      resetsAt: legacyResetsAtMs(item),
      quantity: null,
      limit: null,
    }
  }
  if (type === 'TIME_LIMIT' || type === 'MCP usage(1 Month)') {
    const quantity = typeof item.currentValue === 'number' ? item.currentValue
      : typeof item.currentUsage === 'number' ? item.currentUsage : null
    const limit = typeof item.usage === 'number' ? item.usage
      : typeof item.totol === 'number' ? item.totol : null
    return {
      id: `glm-mcp-${index}`,
      label: 'MCP 用量（1 个月）',
      scope: 'tool',
      durationMs: null,
      usedRatio: ratio,
      resetsAt: legacyResetsAtMs(item),
      quantity,
      limit,
    }
  }
  if (type === 'CREDIT_LIMIT') {
    return {
      id: `glm-credit-${index}`,
      label: `积分额度 ${index + 1}（周期未知）`,
      scope: 'credit',
      durationMs: null,
      usedRatio: ratio,
      resetsAt: creditResetsAtMs(item),
      credit: {
        currentValue: count(item?.currentValue),
        usage: count(item?.usage),
        remaining: count(item?.remaining),
      },
    }
  }
  return {
    id: `glm-other-${index}`,
    label: '未识别额度',
    scope: 'unknown',
    durationMs: null,
    usedRatio: ratio,
    resetsAt: legacyResetsAtMs(item),
    quantity: null,
    limit: null,
  }
}

/** Field mapping follows the pinned official script. It does not invent a weekly window. */
export function parseGlmQuota(payload) {
  if (payload?.success === false) {
    return {
      ok: false,
      code: 'glm-rejected',
      experimental: false,
      message: 'GLM 返回 success=false，额度不可读，已保留上次结果。',
    }
  }
  const data = payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data : payload
  const limits = data?.limits
  if (!Array.isArray(limits) || limits.length === 0) {
    return {
      ok: false,
      code: 'incomplete',
      experimental: false,
      message: '额度响应缺少 limits，已保留上次结果。',
    }
  }
  return {
    ok: true,
    windows: limits.map(oneLimit),
    source: 'GET /api/monitor/usage/quota/limit',
    experimental: false,
    note: '5 小时来自官方脚本对 TOKENS_LIMIT 的标注；周窗口和重置时间只在响应里真有时才出现。CREDIT_LIMIT 只展示原始 currentValue/usage/remaining，周期和积分单位未在官方脚本定义。',
  }
}

export function retryAfterMs(header, now = Date.now()) {
  const text = header == null ? '' : String(header).trim()
  if (/^\d+$/.test(text)) return { ms: Number(text) * 1000, invalid: false }
  if (text) {
    const parsed = Date.parse(text)
    if (Number.isFinite(parsed)) return { ms: Math.max(0, parsed - now), invalid: false }
  }
  return { ms: CONSERVATIVE_RETRY_MS, invalid: true }
}

export async function queryGlm({ liveReads = false, platform = 'zhipu', token, hasToken = false, fetch: fetchImpl, signal, now } = {}) {
  const present = hasToken === true || (typeof token === 'string' && token.length > 0)
  if (!present) {
    return { ok: false, code: 'needs-key', experimental: false, message: '未配置 GLM 密钥。' }
  }
  if (!liveReads) {
    return { ok: false, code: 'live-reads-disabled', experimental: false, message: '未授权读取 GLM 订阅额度。' }
  }
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, code: 'needs-key', experimental: false, message: '本地钥匙串和宿主凭据库里都没有 GLM 密钥。' }
  }
  let url
  try {
    url = assertGlmUrl(glmQuotaUrl(platform)).toString()
  } catch (error) {
    return { ok: false, code: error.code ?? 'bad-platform', message: '平台只能是 zhipu 或 zai' }
  }
  const transport = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch
  if (typeof transport !== 'function') {
    return { ok: false, code: 'no-transport', message: '没有 GLM 传输，未发出请求。' }
  }
  let headers
  try {
    headers = assertSafeHeaders({
      Authorization: token,
      Accept: 'application/json',
      'Accept-Language': 'en-US,en',
    })
  } catch (error) {
    return { ok: false, code: error.code ?? 'unsafe-header', message: 'GLM 请求头被拒绝。' }
  }
  try {
    const response = await transport(url, {
      method: 'GET',
      redirect: 'error',
      headers,
      signal,
    })
    const finalUrl = typeof response?.url === 'string' && response.url ? response.url : url
    try {
      assertGlmUrl(finalUrl)
    } catch {
      return { ok: false, code: 'glm-host-rejected', message: 'GLM 响应地址不在允许名单内。' }
    }
    if (response.status === 429) {
      const header = response.headers?.get?.('retry-after') ?? response.headers?.get?.('Retry-After')
      const wait = retryAfterMs(header, now?.() ?? Date.now())
      return {
        ok: false,
        code: 'rate-limited',
        message: wait.invalid
          ? 'GLM 要求稍后重试。Retry-After 无法解析，保守等待 15 分钟。'
          : 'GLM 要求稍后重试。',
        retryAfterMs: wait.ms,
        retryAfterInvalid: wait.invalid,
      }
    }
    if (response.status !== 200) {
      return { ok: false, code: 'glm-http', message: redactText(`GLM HTTP ${response.status}`, [token]) }
    }
    const payload = await response.json()
    return parseGlmQuota(payload)
  } catch (error) {
    if (signal?.aborted) return { ok: false, code: 'aborted', message: '查询已取消。' }
    return {
      ok: false,
      code: 'glm-failed',
      message: redactText(error instanceof Error ? error.message : 'GLM 查询失败', [token]),
    }
  }
}
