import { redactText } from '../redact.js'

/** Experimental SDK method name recorded from OpenBot 0.61.0 claude-client.ts:326,708. Not copied. */
export const CLAUDE_USAGE_METHOD = 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET'
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const SDK_SPECIFIER = '@anthropic-ai/claude-agent-sdk'

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function usedRatioOf(item) {
  // Claude reports utilization/percent as 0-100. A value of 1 is 1% used, not 100%.
  const raw = finiteNumber(item?.utilization) ?? finiteNumber(item?.percent)
  if (raw == null || raw < 0 || raw > 100) return null
  return raw / 100
}

function resetsAtOf(item) {
  const text = item?.resets_at ?? item?.resetsAt
  if (typeof text === 'string' && text.trim()) {
    const parsed = Date.parse(text)
    return Number.isFinite(parsed) ? parsed : null
  }
  const numeric = finiteNumber(item?.resets_at) ?? finiteNumber(item?.resetsAt)
  if (numeric == null || numeric <= 0) return null
  return numeric < 1e12 ? numeric * 1000 : numeric
}

function oneWindow(item, label, durationMs) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const usedRatio = usedRatioOf(item)
  if (usedRatio == null) return null
  return {
    id: `claude-${label}`,
    label,
    scope: 'model',
    durationMs,
    usedRatio,
    resetsAt: resetsAtOf(item),
    quantity: null,
    limit: null,
  }
}

function missingSdk() {
  return {
    ok: false,
    code: 'sdk-missing',
    experimental: true,
    message: '本机没有 @anthropic-ai/claude-agent-sdk@0.3.309。OpenBot 0.61.0 src/backend/claude-client.ts 约 696-728 行通过 query() 调用 usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })。最小需求：可注入的 query 工厂，或安装该版本的 SDK；建议命令见 docs/sources.md，本轮没有安装。未复制其 PolyForm-Noncommercial 代码。',
  }
}

/** Independent mapping of five_hour / seven_day. Does not copy OpenBot parsers. */
export function parseClaudeUsage(payload) {
  if (!payload || payload.rate_limits_available !== true || !payload.rate_limits || typeof payload.rate_limits !== 'object') {
    return {
      ok: false,
      code: 'incomplete',
      experimental: true,
      message: 'Claude 用量读取没有可用的速率窗口。',
    }
  }
  const limits = payload.rate_limits
  const weeklySource = limits.seven_day ?? limits.seven_day_sonnet ?? limits.seven_day_opus
  const windows = [
    oneWindow(limits.five_hour, '5小时', FIVE_HOURS_MS),
    oneWindow(weeklySource, '1周', WEEK_MS),
  ].filter(Boolean)
  if (windows.length === 0) {
    return {
      ok: false,
      code: 'incomplete',
      experimental: true,
      message: 'Claude 用量读取没有可用的速率窗口。',
    }
  }
  return {
    ok: true,
    windows,
    source: 'claude-agent-sdk usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET',
    experimental: true,
    note: '实验 SDK 方法，可能随时改名。字段按 five_hour / seven_day 独立映射。',
  }
}

export async function queryClaude({ liveReads = false, queryFactory, importSdk, signal } = {}) {
  if (!liveReads) {
    return {
      ok: false,
      code: 'live-reads-disabled',
      experimental: true,
      message: '未授权读取 Claude 实验用量接口。',
    }
  }
  let factory = queryFactory
  if (typeof factory !== 'function') {
    const load = typeof importSdk === 'function' ? importSdk : () => import(SDK_SPECIFIER)
    try {
      const mod = await load()
      factory = mod?.query ?? mod?.default?.query
    } catch {
      return missingSdk()
    }
  }
  if (typeof factory !== 'function') return missingSdk()
  let session
  try {
    session = factory({ prompt: (async function* emptyPrompt() {})() })
    const readUsage = session?.[CLAUDE_USAGE_METHOD]
    if (typeof readUsage !== 'function') {
      return {
        ok: false,
        code: 'source-unverified',
        experimental: true,
        message: `SDK 没有 ${CLAUDE_USAGE_METHOD}。`,
      }
    }
    const usage = await readUsage.call(session, { skipBehaviors: true })
    if (signal?.aborted) return { ok: false, code: 'aborted', experimental: true, message: '查询已取消。' }
    return parseClaudeUsage(usage)
  } catch (error) {
    if (signal?.aborted) return { ok: false, code: 'aborted', experimental: true, message: '查询已取消。' }
    return {
      ok: false,
      code: 'claude-failed',
      experimental: true,
      message: redactText(error instanceof Error ? error.message : 'Claude 查询失败'),
    }
  } finally {
    try { session?.close?.() } catch { /* session may already be closed */ }
  }
}
