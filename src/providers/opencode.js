import { assertSafeHeaders } from '../http.js'
import { redactText } from '../redact.js'

export const OPENCODE_USAGE_PATH = '/zen/go/v1/usage'
export const OPENCODE_ALLOWED_HOSTS = Object.freeze(new Set(['opencode.ai']))
export const OPENCODE_USAGE_URL = `https://opencode.ai${OPENCODE_USAGE_PATH}`
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const MONTH_MS = 30 * 24 * 60 * 60 * 1000

export function assertOpenCodeUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !OPENCODE_ALLOWED_HOSTS.has(url.hostname) || url.pathname !== OPENCODE_USAGE_PATH || url.search) {
    const error = new Error('OpenCode 额度地址不在允许名单内')
    error.code = 'opencode-host-rejected'
    throw error
  }
  return url
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function usedRatioOf(item) {
  // OpenCode reports percent as 0-100. A value of 1 is 1% used, not 100%.
  const raw = finiteNumber(item?.percent) ?? finiteNumber(item?.percentage)
  if (raw == null || raw < 0 || raw > 100) return null
  return raw / 100
}

function resetsAtOf(item) {
  const text = item?.resetsAt ?? item?.resets_at
  if (typeof text === 'string' && text.trim()) {
    const parsed = Date.parse(text)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function oneWindow(item, id, label, scope, durationMs) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const usedRatio = usedRatioOf(item)
  if (usedRatio == null) return null
  return {
    id,
    label,
    scope,
    durationMs,
    usedRatio,
    resetsAt: resetsAtOf(item),
    quantity: null,
    limit: null,
  }
}

/** Independent mapping of rolling/weekly/monthly. Monthly stays a tool window. */
export function parseOpenCodeUsage(payload) {
  const usage = payload?.usage
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return {
      ok: false,
      code: 'incomplete',
      experimental: true,
      message: 'OpenCode 用量读取缺少 usage。',
    }
  }
  const rolling = oneWindow(usage.rolling, 'opencode-rolling', '5小时', 'model', FIVE_HOURS_MS)
  const weekly = oneWindow(usage.weekly, 'opencode-weekly', '1周', 'model', WEEK_MS)
  const monthly = oneWindow(usage.monthly, 'opencode-monthly', 'MCP 用量（1 个月）', 'tool', MONTH_MS)
  const windows = [rolling, weekly, monthly].filter(Boolean)
  if (windows.length === 0) {
    return {
      ok: false,
      code: 'incomplete',
      experimental: true,
      message: 'OpenCode 用量读取没有可用窗口。',
    }
  }
  return {
    ok: true,
    windows,
    source: 'GET /zen/go/v1/usage',
    experimental: true,
    note: '实验控制台用量接口，未写入 OpenCode 官方 Go 文档。圆环最多两个模型窗口；月额度标成工具。',
  }
}

export async function queryOpenCode({ liveReads = false, token, fetch: fetchImpl, signal } = {}) {
  if (!liveReads) {
    return {
      ok: false,
      code: 'live-reads-disabled',
      experimental: true,
      message: '未授权读取 OpenCode Go 实验用量接口。',
    }
  }
  if (typeof token !== 'string' || token.length === 0) {
    return {
      ok: false,
      code: 'needs-key',
      experimental: true,
      message: '没有注入的 OpenCode 密钥。插件不读取 auth.json、环境变量或本机数据库。',
    }
  }
  let url
  try {
    url = assertOpenCodeUrl(OPENCODE_USAGE_URL).toString()
  } catch (error) {
    return { ok: false, code: error.code ?? 'opencode-host-rejected', experimental: true, message: 'OpenCode 额度地址不在允许名单内。' }
  }
  const transport = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch
  if (typeof transport !== 'function') {
    return { ok: false, code: 'no-transport', experimental: true, message: '没有 OpenCode 传输，未发出请求。' }
  }
  let headers
  try {
    headers = assertSafeHeaders({
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    })
  } catch (error) {
    return { ok: false, code: error.code ?? 'unsafe-header', experimental: true, message: 'OpenCode 请求头被拒绝。' }
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
      assertOpenCodeUrl(finalUrl)
    } catch {
      return { ok: false, code: 'opencode-host-rejected', experimental: true, message: 'OpenCode 响应地址不在允许名单内。' }
    }
    if (response.status !== 200) {
      return { ok: false, code: 'opencode-http', experimental: true, message: redactText(`OpenCode HTTP ${response.status}`, [token]) }
    }
    const payload = await response.json()
    return parseOpenCodeUsage(payload)
  } catch (error) {
    if (signal?.aborted) return { ok: false, code: 'aborted', experimental: true, message: '查询已取消。' }
    if (error?.code === 'unsafe-header') {
      return { ok: false, code: 'unsafe-header', experimental: true, message: 'OpenCode 请求头被拒绝。' }
    }
    return {
      ok: false,
      code: 'opencode-failed',
      experimental: true,
      message: redactText(error instanceof Error ? error.message : 'OpenCode 查询失败', [token]),
    }
  }
}
