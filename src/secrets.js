import { spawn } from 'node:child_process'

export const KEYCHAIN_SERVICE = 'dsh-provider-quota-rings'
export const GLM_ACCOUNT = 'glm'
export const OPENCODE_ACCOUNT = 'opencode'
const ALLOWED_ACCOUNTS = new Set([GLM_ACCOUNT, OPENCODE_ACCOUNT])

export function processRunner({ command, args = [], stdin = '' }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', () => resolve({ code: 127, stdout: '', stderr: '', args }))
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        args,
      })
    })
    child.stdin.end(stdin)
  })
}

function leaked(secret, args) {
  if (!secret) return false
  return args.some((item) => String(item).includes(secret))
}

export function createSecretStore({
  runner = processRunner,
  platform = process.platform,
  arch = process.arch,
  helperPath = null,
  scriptPath = null,
} = {}) {
  async function invoke(op, account, secret) {
    if (op !== 'ping' && !ALLOWED_ACCOUNTS.has(account)) {
      return { ok: false, code: 'account-not-allowed', message: '这个账户名不在插件的钥匙串白名单里。' }
    }
    const payload = JSON.stringify({
      op,
      service: KEYCHAIN_SERVICE,
      account,
      ...(secret ? { secret } : {}),
    })
    if (platform === 'darwin') {
      if (arch !== 'arm64') {
        return {
          ok: false,
          code: 'keychain-helper-unsupported-arch',
          message: `钥匙串助手只编译了 arm64，当前架构是 ${arch}。`,
        }
      }
      if (!helperPath) {
        return { ok: false, code: 'keychain-helper-not-built', message: '钥匙串助手还没有编译，密钥不会写入文件。' }
      }
      const result = await runner({ command: helperPath, args: [], stdin: payload })
      if (leaked(secret, result?.args ?? [])) {
        return { ok: false, code: 'secret-on-argv', message: '已拒绝把密钥放进进程参数。' }
      }
      return readResult(result, secret, op)
    }
    if (platform === 'win32') {
      if (!scriptPath) {
        return { ok: false, code: 'keychain-helper-not-built', message: 'Windows DPAPI 脚本未配置，密钥不会写入明文文件。' }
      }
      const result = await runner({
        command: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-File', scriptPath],
        stdin: payload,
      })
      if (leaked(secret, result?.args ?? [])) {
        return { ok: false, code: 'secret-on-argv', message: '已拒绝把密钥放进进程参数。' }
      }
      return readResult(result, secret, op)
    }
    return { ok: false, code: 'unsupported-platform', message: '当前系统没有钥匙串实现。' }
  }

  return {
    set(account, secret) {
      if (typeof secret !== 'string' || secret.length === 0) return Promise.resolve({ ok: false, code: 'empty', message: '密钥是空的。' })
      return invoke('set', account, secret)
    },
    get(account) { return invoke('get', account) },
    delete(account) { return invoke('delete', account) },
    ping() { return invoke('ping', GLM_ACCOUNT) },
  }
}

function readResult(result, secret, op) {
  let parsed = null
  try { parsed = JSON.parse(String(result?.stdout ?? '').trim() || '{}') } catch { parsed = null }
  if (!parsed || parsed.ok !== true) {
    return { ok: false, code: parsed?.code || 'keychain-failed', message: '钥匙串没有完成这次操作。' }
  }
  if (op === 'get') {
    if (typeof parsed.secret !== 'string' || parsed.secret.length === 0) {
      return { ok: false, code: 'keychain-failed', message: '钥匙串没有返回密钥。' }
    }
    return { ok: true, secret: parsed.secret }
  }
  if (typeof parsed.secret === 'string' || (secret && String(result.stdout).includes(secret))) {
    return { ok: false, code: 'secret-in-output', message: '钥匙串输出里出现了密钥，已丢弃。' }
  }
  return { ok: true }
}
