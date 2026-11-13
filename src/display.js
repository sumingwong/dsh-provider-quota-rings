import { PROVIDERS, PROVIDER_LABELS, remainingFraction, selectRings } from './model.js'
import { limitPublicText, redactText } from './redact.js'

export function scopeText(scope) {
  if (scope === 'model') return '模型'
  if (scope === 'tool') return '工具（月额度）'
  if (scope === 'credit') return '积分（周期未知）'
  return '未知范围'
}

export function remainingText(window) {
  const fraction = remainingFraction(window)
  if (fraction == null) return '未知'
  return `${Math.round(fraction * 100)}%`
}

function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function quantityText(window) {
  if (!window) return '未知'
  if (window.scope === 'credit') {
    const currentValue = count(window.credit?.currentValue)
    const usage = count(window.credit?.usage)
    const remaining = count(window.credit?.remaining)
    const parts = []
    if (currentValue != null) parts.push(`currentValue ${currentValue}`)
    if (usage != null) parts.push(`usage ${usage}`)
    if (remaining != null) parts.push(`remaining ${remaining}`)
    return parts.length > 0 ? parts.join('，') : '未知'
  }
  if (typeof window.quantity === 'number' && typeof window.limit === 'number') return `${window.quantity}/${window.limit}`
  if (typeof window.quantity === 'number') return String(window.quantity)
  return '未知'
}

export function resetText(window) {
  const at = window?.resetsAt
  if (typeof at !== 'number' || !Number.isFinite(at)) return '未知'
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return '未知'
  return date.toISOString()
}

/** Time until reset. Missing, non-finite, or out-of-range timestamps stay 未知. */
export function resetDistanceText(window, now = Date.now()) {
  const at = window?.resetsAt
  if (typeof at !== 'number' || !Number.isFinite(at)) return '未知'
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return '未知'
  const delta = at - now
  if (delta <= 0) return '已到重置点'
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const days = Math.floor(delta / day)
  const hours = Math.floor((delta % day) / hour)
  const minutes = Math.floor((delta % hour) / minute)
  if (days > 0) return hours > 0 ? `${days}天${hours}小时` : `${days}天`
  if (hours > 0) return minutes > 0 ? `${hours}小时${minutes}分` : `${hours}小时`
  if (minutes > 0) return `${minutes}分`
  return '不到1分'
}

function statusText(row) {
  if (row.status === 'disabled') return '已停用'
  if (row.status === 'unread') return '暂无法读取'
  if (row.status === 'example') return '示例数据'
  if (row.status === 'stale') {
    const when = row.updatedAt ? new Date(row.updatedAt).toISOString() : '未知时间'
    return `数据较旧 ${when}${row.error ? ` ${row.error}` : ''}`
  }
  if (row.status === 'fresh' && row.updatedAt) return `已更新 ${new Date(row.updatedAt).toISOString()}`
  if (row.error) return `未知 ${row.error}`
  return '未知'
}

function ringsOf(row) {
  if (row.status === 'disabled') return [{ fraction: null, caption: '已停用', title: '已停用' }]
  const selected = selectRings(row.windows).map((ring) => ({
    fraction: ring.fraction,
    caption: ring.caption,
    title: ring.title,
  }))
  if (selected.length > 0) return selected
  return [{ fraction: null, caption: '未知', title: '没有已知周期' }]
}

export function publicLink(link) {
  if (!link || typeof link !== 'object') return null
  const href = String(link.href ?? '')
  let url
  try { url = new URL(href) } catch { return null }
  if (url.protocol !== 'https:') return null
  return {
    href,
    label: limitPublicText(redactText(String(link.label ?? url.hostname))),
  }
}

export function hoverText(row) {
  const rings = (row?.rings ?? []).map((item) => {
    const amount = typeof item.fraction === 'number' && Number.isFinite(item.fraction)
      ? `${Math.round(item.fraction * 100)}%`
      : '未知'
    return `${item.caption || '未知'} ${amount}`
  })
  const when = typeof row?.updatedAt === 'number' && Number.isFinite(row.updatedAt)
    ? new Date(row.updatedAt).toISOString()
    : '时间未知'
  return [row?.label, row?.statusText, rings.join(' · '), when].filter(Boolean).join(' ')
}

export function toDisplay(snapshot, now = Date.now()) {
  const rows = PROVIDERS.map((id) => {
    const row = snapshot.byId?.[id] ?? { status: 'unknown', windows: [] }
    const platformLabel = id === 'glm' ? (snapshot.glmPlatform === 'zai' ? 'Z.AI' : '智谱') : null
    const disabled = row.status === 'disabled'
    return {
      id,
      label: PROVIDER_LABELS[id],
      platform: id === 'glm' ? snapshot.glmPlatform : null,
      platformLabel,
      status: row.status ?? 'unknown',
      statusText: limitPublicText(statusText({ ...row, error: row.error ? limitPublicText(redactText(row.error)) : null })),
      experimental: row.experimental === true,
      updatedAt: row.updatedAt ?? null,
      error: row.error ? limitPublicText(redactText(row.error)) : null,
      source: row.source ?? null,
      note: row.note ?? null,
      link: publicLink(row.link),
      rings: ringsOf(row),
      windows: (row.windows ?? []).map((window) => {
        const quantity = quantityText(window)
        const credit = window.scope === 'credit'
          ? {
            currentValue: count(window.credit?.currentValue),
            usage: count(window.credit?.usage),
            remaining: count(window.credit?.remaining),
          }
          : null
        return {
          label: limitPublicText(redactText(window.label ?? '未命名窗口')),
          scope: window.scope ?? 'unknown',
          scopeText: scopeText(window.scope),
          fraction: disabled ? null : remainingFraction(window),
          remainingText: disabled ? '未知' : remainingText(window),
          resetText: resetText(window),
          resetDistanceText: resetDistanceText(window, now),
          showQuantity: quantity !== '未知',
          quantityLabel: window.scope === 'credit' ? '积分字段' : '数量',
          quantityText: quantity,
          credit,
        }
      }),
    }
  })
  return {
    exampleData: false,
    glmPlatform: snapshot.glmPlatform ?? 'zhipu',
    glmKeyStored: snapshot.glmKeyStored === true,
    opencodeKeyStored: snapshot.opencodeKeyStored === true,
    liveReads: snapshot.liveReads === true,
    rows,
  }
}
