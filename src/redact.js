const SECRET_KEY = /token|secret|password|authorization|cookie|api[-_]?key/i

const ASSIGNMENT = /\b(authorization|token|secret|password|api[-_]?key|cookie)\b\s*[:=]\s*("[^"]*"|'[^']*'|Bearer\s+\S+|\S+)/gi
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^@\s/]+@/gi
const LONG_FLAG = /(--(?:password|token|secret|api-key|apikey))(=|\s+)\S+/gi
const SHORT_P = /(^|\s)-p(?:\s+\S+|\S*)/g
const BEARER = /\bBearer\s+\S+/gi

export const PUBLIC_TEXT_MAX = 160

export function isSecretKey(key) {
  return SECRET_KEY.test(String(key))
}

export function redactText(value, secrets = []) {
  let text = value == null ? '' : String(value)
  const extras = secrets.filter((item) => typeof item === 'string' && item.length >= 4)
  for (const secret of extras) text = text.split(secret).join('[redacted]')
  text = text.replace(ASSIGNMENT, '$1=[redacted]')
  text = text.replace(URL_USERINFO, '$1[redacted]@')
  text = text.replace(LONG_FLAG, '$1=[redacted]')
  text = text.replace(SHORT_P, '$1-p[redacted]')
  text = text.replace(BEARER, 'Bearer [redacted]')
  return text
}

export function limitPublicText(value, max = PUBLIC_TEXT_MAX) {
  const text = value == null ? '' : String(value)
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

export function redactValue(value, secrets = []) {
  if (typeof value === 'string') return limitPublicText(redactText(value, secrets))
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets))
  if (!value || typeof value !== 'object') return value
  const copy = {}
  for (const [key, item] of Object.entries(value)) {
    if (isSecretKey(key)) continue
    copy[key] = redactValue(item, secrets)
  }
  return copy
}
