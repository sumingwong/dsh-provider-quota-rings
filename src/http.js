/** Reject CR/LF in header names and values before any bytes are sent. */
export function assertSafeHeaders(headers) {
  const out = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    const key = String(name)
    const text = value == null ? '' : String(value)
    if (/[\r\n]/.test(key) || /[\r\n]/.test(text)) {
      const error = new Error('请求头含有 CR/LF')
      error.code = 'unsafe-header'
      throw error
    }
    out[key] = text
  }
  return out
}
