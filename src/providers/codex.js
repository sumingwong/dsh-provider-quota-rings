import fs from 'node:fs'
import path from 'node:path'
import { redactText } from '../redact.js'
import packageJson from '../../package.json' with { type: 'json' }

const version = packageJson.version

export const CODEX_CANDIDATES = Object.freeze(['/opt/homebrew/bin/codex', '/usr/local/bin/codex'])

const CODEX_WIN_CANDIDATES = Object.freeze([
  'LOCALAPPDATA|Programs\\codex\\codex.exe',
  'APPDATA|npm\\codex.cmd',
  'ProgramFiles|codex\\codex.exe',
  'USERPROFILE|AppData\\Local\\Programs\\codex\\codex.exe',
])

const WINDOWS_NODE_CANDIDATES = Object.freeze([
  'ProgramFiles|nodejs\\node.exe',
  'ProgramFiles(x86)|nodejs\\node.exe',
  'ProgramW6432|nodejs\\node.exe',
  'LOCALAPPDATA|Programs\\nodejs\\node.exe',
  'USERPROFILE|scoop\\apps\\nodejs\\current\\node.exe',
  'NVM_SYMLINK|node.exe',
])

const METHOD = 'account/rateLimits/read'

function finitePercent(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
}

function resetsAtMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value < 1e12 ? value * 1000 : value
}

function windowsOf(bucket) {
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return []
  if (Array.isArray(bucket.windows)) return bucket.windows.filter((item) => item && typeof item === 'object')
  const found = []
  if (bucket.primary && typeof bucket.primary === 'object') found.push(bucket.primary)
  if (bucket.secondary && typeof bucket.secondary === 'object') found.push(bucket.secondary)
  if (found.length === 0 && (bucket.usedPercent != null || bucket.windowDurationMins != null)) found.push(bucket)
  return found
}

function oneWindow(bucketId, item, index) {
  const minutes = item.windowDurationMins
  const durationMs = typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0
    ? minutes * 60 * 1000
    : null
  const usedRatio = finitePercent(item.usedPercent) ? item.usedPercent / 100 : null
  return {
    id: `${bucketId}:${index}`,
    label: durationMs == null ? 'Codex 窗口（时长未知）' : `Codex ${minutes} 分钟`,
    scope: 'model',
    durationMs,
    usedRatio,
    resetsAt: resetsAtMs(item.resetsAt),
    quantity: null,
    limit: null,
  }
}

/** Map a documented account/rateLimits/read payload. credits.balance is never a ring. */
export function parseCodexRateLimits(payload) {
  const body = payload?.result && typeof payload.result === 'object' ? payload.result : payload
  const source = body && typeof body === 'object' ? body : {}
  const buckets = []
  if (source.rateLimitsByLimitId && typeof source.rateLimitsByLimitId === 'object') {
    for (const [id, bucket] of Object.entries(source.rateLimitsByLimitId)) buckets.push([id, bucket])
  } else if (source.rateLimits && typeof source.rateLimits === 'object') {
    buckets.push(['primary', source.rateLimits])
  }
  const windows = []
  for (const [id, bucket] of buckets) {
    windowsOf(bucket).forEach((item, index) => windows.push(oneWindow(id, item, index)))
  }
  const note = source.credits && typeof source.credits === 'object' && typeof source.credits.balance === 'number'
    ? 'credits.balance 是金额，不画成订阅圆环。'
    : null
  return {
    ok: true,
    windows,
    source: 'codex account/rateLimits/read',
    experimental: false,
    note,
  }
}

export function windowsCodexCandidates(env = process.env) {
  const candidates = []
  for (const entry of CODEX_WIN_CANDIDATES) {
    const [variable, suffix] = entry.split('|')
    const base = env[variable]
    if (typeof base !== 'string' || base.length === 0) continue
    candidates.push(`${base.replace(/[\\/]+$/, '')}\\${suffix}`)
  }
  return candidates
}

export function resolveCodexBinary(exists = fs.existsSync, platform = process.platform, env = process.env) {
  const candidates = platform === 'win32' ? windowsCodexCandidates(env) : CODEX_CANDIDATES
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }
  return null
}

export function absoluteForPlatform(command, platform = process.platform) {
  return platform === 'win32' ? path.win32.isAbsolute(command) : path.isAbsolute(command)
}

export function windowsNodeCandidates(env = process.env) {
  const candidates = []
  for (const entry of WINDOWS_NODE_CANDIDATES) {
    const [variable, suffix] = entry.split('|')
    const base = env[variable]
    if (typeof base !== 'string' || base.length === 0) continue
    candidates.push(`${base.replace(/[\\/]+$/, '')}\\${suffix}`)
  }
  return candidates
}

export function windowsNodeDirectories(env = process.env, exists = fs.existsSync) {
  const dirs = []
  const seen = new Set()
  for (const candidate of windowsNodeCandidates(env)) {
    if (!exists(candidate)) continue
    const dir = path.win32.dirname(candidate)
    const key = dir.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    dirs.push(dir)
  }
  return dirs
}

export function windowsShell(env = process.env) {
  const root = [env.SystemRoot, env.SYSTEMROOT].find((value) => typeof value === 'string' && path.win32.isAbsolute(value))
  return path.win32.join(root ?? 'C:\\Windows', 'System32', 'cmd.exe')
}

function quoteForCmd(value) {
  if (typeof value !== 'string' || value.length === 0 || /[\0\r\n"]/.test(value)) return null
  return `"${value}"`
}

/**
 * `.cmd`/`.bat` is not a PE executable. Windows npm installs are shims that
 * must run through the fixed system cmd.exe and need a Node directory reachable
 * in PATH. No PATH scan and no caller-supplied shell string.
 */
export function codexSpawnPlan(command, args, platform = process.platform, env = process.env, exists = fs.existsSync) {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(command)) {
    return { command, args, windowsVerbatimArguments: false }
  }
  const quoted = quoteForCmd(command)
  if (!quoted) {
    return { error: 'codex-unsafe-path', message: 'Windows codex 入口含无法安全引用的字符，未启动进程。' }
  }
  const localNodeDir = path.win32.dirname(command)
  const hasNode = exists(path.win32.join(localNodeDir, 'node.exe')) || windowsNodeDirectories(env, exists).length > 0
  if (!hasNode) {
    return {
      error: 'codex-node-missing',
      message: '找到 codex.cmd，但固定的 Node.js 安装位置不可用；不会从 PATH 启动。',
    }
  }
  const quotedArgs = args.map((arg) => {
    if (typeof arg === 'string' && /^[A-Za-z0-9._:-]+$/.test(arg)) return arg
    return quoteForCmd(arg)
  })
  if (quotedArgs.some((arg) => arg == null)) {
    return { error: 'codex-unsafe-args', message: 'codex 启动参数含无法安全引用的字符，未启动进程。' }
  }
  return {
    command: windowsShell(env),
    args: ['/d', '/s', '/v:off', '/c', `"${quoted} ${quotedArgs.join(' ')}"`],
    windowsVerbatimArguments: true,
  }
}

export function codexChildEnv(source = process.env, platform = process.platform, exists = fs.existsSync, extraNodeDir = null) {
  const pathParts = platform === 'win32'
    ? ['C:\\Windows\\System32']
    : ['/usr/bin', '/bin', '/opt/homebrew/bin', '/usr/local/bin']
  if (platform === 'win32') {
    const seen = new Set(pathParts.map((value) => value.toLowerCase()))
    const nodeDirs = []
    if (typeof extraNodeDir === 'string' && extraNodeDir.length > 0 &&
        exists(path.win32.join(extraNodeDir, 'node.exe'))) nodeDirs.push(extraNodeDir)
    nodeDirs.push(...windowsNodeDirectories(source, exists))
    for (const dir of nodeDirs) {
      const key = dir.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      pathParts.push(dir)
    }
  }
  const env = {
    PATH: pathParts.join(platform === 'win32' ? ';' : ':'),
    LANG: 'C',
    HOME: typeof source.HOME === 'string' ? source.HOME : '',
    TMPDIR: typeof source.TMPDIR === 'string' ? source.TMPDIR : (platform === 'win32' ? '' : '/tmp'),
  }
  if (platform === 'win32' && typeof source.SYSTEMROOT === 'string') env.SYSTEMROOT = source.SYSTEMROOT
  if (platform === 'win32') {
    env.ComSpec = windowsShell(source)
    for (const name of ['USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP']) {
      if (typeof source[name] === 'string') env[name] = source[name]
    }
  }
  return env
}

export function stopChild(child, kill = process.kill) {
  try { child?.stdin?.end?.() } catch { /* already closed */ }
  const pid = child?.pid
  if (typeof pid === 'number' && pid > 0) {
    try { kill(-pid, 'SIGTERM') } catch { /* the process may not be a group leader */ }
  }
  try { child?.kill?.('SIGTERM') } catch { /* already gone */ }
}

function writeLine(stdin, message) {
  stdin.write(`${JSON.stringify(message)}\n`)
}

function listen(stdout, onLine) {
  let buffer = ''
  const onData = (chunk) => {
    buffer += chunk.toString('utf8')
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) onLine(line)
      newline = buffer.indexOf('\n')
    }
  }
  stdout.on('data', onData)
  return () => stdout.off?.('data', onData)
}

/**
 * stdio JSON-RPC channel. Does not spawn unless liveReads is true and spawn is injected.
 * Handshake field names beyond the method are not a live-verified contract.
 */
export async function queryCodex({
  liveReads = false,
  spawn,
  signal,
  stop = stopChild,
  timeoutMs = 10000,
  binary,
  platform = process.platform,
  exists = fs.existsSync,
} = {}) {
  if (!liveReads) {
    return {
      ok: false,
      code: 'live-reads-disabled',
      experimental: false,
      message: '未授权调用本地 codex app-server 的 account/rateLimits/read。',
    }
  }
  if (typeof spawn !== 'function') {
    return { ok: false, code: 'no-transport', experimental: false, message: '没有 Codex 传输，未启动进程。' }
  }
  const command = typeof binary === 'string' ? binary : resolveCodexBinary(exists, platform)
  if (typeof command !== 'string' || !absoluteForPlatform(command, platform)) {
    return {
      ok: false,
      code: 'codex-binary-missing',
      experimental: false,
      message: platform === 'win32'
        ? '没有在 LOCALAPPDATA、APPDATA、ProgramFiles 的固定位置找到 codex.exe/codex.cmd，不会从 PATH 启动。'
        : '没有固定绝对路径上的 codex，不会从 PATH 启动。',
    }
  }
  const extraNodeDir = platform === 'win32' ? path.win32.dirname(command) : null
  const plan = codexSpawnPlan(command, ['app-server'], platform, process.env, exists)
  if (plan.error) {
    return { ok: false, code: plan.error, experimental: false, message: plan.message }
  }
  const child = spawn(plan.command, plan.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: codexChildEnv(process.env, platform, exists, extraNodeDir),
    detached: platform !== 'win32',
    windowsHide: true,
    ...(plan.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
  })
  let settled = false
  let timer = null
  let stopListen = () => {}
  let abort = () => {}
  try {
    return await new Promise((resolve) => {
      const done = (value) => {
        if (settled) return
        settled = true
        if (timer != null) clearTimeout(timer)
        stopListen()
        signal?.removeEventListener?.('abort', abort)
        resolve(value)
      }
      abort = () => done({ ok: false, code: 'aborted', message: '查询已取消。' })
      timer = setTimeout(() => done({
        ok: false,
        code: 'codex-failed',
        experimental: false,
        message: 'codex app-server 超时',
      }), timeoutMs)
      if (child.stdout && typeof child.stdout.on === 'function') {
        stopListen = listen(child.stdout, (line) => {
          let message
          try { message = JSON.parse(line) } catch { return }
          if (message.id === 1 && message.result) {
            writeLine(child.stdin, { jsonrpc: '2.0', method: 'initialized' })
            writeLine(child.stdin, { jsonrpc: '2.0', id: 2, method: METHOD, params: {} })
          } else if (message.id === 2) {
            if (message.error) {
              done({ ok: false, code: 'codex-failed', experimental: false, message: 'codex account/rateLimits/read 失败' })
            } else done(parseCodexRateLimits(message))
          }
        })
        child.stdout.on('close', () => done({
          ok: false,
          code: 'codex-failed',
          experimental: false,
          message: 'codex app-server 输出已关闭',
        }))
      }
      child.once?.('close', () => done({
        ok: false,
        code: 'codex-failed',
        experimental: false,
        message: 'codex app-server 已退出',
      }))
      child.once?.('error', (error) => done({
        ok: false,
        code: 'codex-failed',
        experimental: false,
        message: redactText(error instanceof Error ? error.message : 'Codex 查询失败'),
      }))
      signal?.addEventListener?.('abort', abort, { once: true })
      if (signal?.aborted) {
        abort()
        return
      }
      writeLine(child.stdin, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'dsh-provider-quota-rings', version } },
      })
    })
  } finally {
    signal?.removeEventListener?.('abort', abort)
    if (timer != null) clearTimeout(timer)
    stopListen()
    try { stop(child) } catch { /* caller supplied a test double */ }
  }
}
