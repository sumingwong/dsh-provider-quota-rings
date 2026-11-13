import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { codexChildEnv, codexSpawnPlan, parseCodexRateLimits, queryCodex, resolveCodexBinary, stopChild } from '../src/providers/codex.js'
import { CLAUDE_USAGE_METHOD, parseClaudeUsage, queryClaude } from '../src/providers/claude.js'
import { assertGlmUrl, parseGlmQuota, queryGlm, CONSERVATIVE_RETRY_MS } from '../src/providers/glm.js'
import { assertOpenCodeUrl, parseOpenCodeUsage, queryOpenCode } from '../src/providers/opencode.js'
import { selectRings } from '../src/model.js'
import { queryGrok } from '../src/providers/placeholders.js'
import { quantityText, remainingText, resetText, scopeText } from '../src/display.js'

test('codex parser keeps one real window and ignores credits and account id', () => {
  const parsed = parseCodexRateLimits({
    accountId: 'acct_should_not_leak',
    rateLimits: {
      primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_700_000_000 },
      secondary: null,
    },
    credits: { balance: 12.5 },
  })
  assert.equal(parsed.windows.length, 1)
  assert.equal(parsed.windows[0].usedRatio, 0.25)
  assert.equal(parsed.windows[0].durationMs, 300 * 60 * 1000)
  assert.equal(parsed.windows[0].resetsAt, 1_700_000_000_000)
  assert.equal(selectRings(parsed.windows).length, 1)
  assert.match(parsed.note, /credits/)
  assert.equal(JSON.stringify(parsed).includes('acct_should_not_leak'), false)
})

test('codex parser does not invent a second window', () => {
  const parsed = parseCodexRateLimits({
    rateLimitsByLimitId: {
      weekly: { windows: [{ usedPercent: 10, windowDurationMins: 10080, resetsAt: null }] },
    },
  })
  assert.equal(parsed.windows.length, 1)
  assert.deepEqual(selectRings(parsed.windows).map((ring) => ring.caption), ['1周'])
  const missing = parseCodexRateLimits({ rateLimits: { primary: { windowDurationMins: 300 } } })
  assert.equal(remainingText(missing.windows[0]), '未知')
  assert.equal(selectRings(missing.windows).length, 0)
})

test('codex query stays closed unless live reads and a transport are both enabled', async () => {
  let spawned = 0
  const closed = await queryCodex({ liveReads: false, spawn() { spawned += 1 } })
  assert.equal(closed.code, 'live-reads-disabled')
  assert.equal(spawned, 0)
  const writes = []
  const stopped = []
  const stdout = new EventEmitter()
  const child = {
    pid: 424242,
    stdin: {
      write(chunk) {
        writes.push(String(chunk))
        const message = JSON.parse(String(chunk))
        if (message.method === 'initialize') {
          stdout.emit('data', Buffer.from('{"jsonrpc":"2.0","id":1,"result":{}}\n'))
        }
        if (message.method === 'account/rateLimits/read') {
          stdout.emit('data', Buffer.from('{"jsonrpc":"2.0","id":2,"error":{"message":"no"}}\n'))
        }
      },
      end() {},
    },
    stdout,
    once() {},
    kill() {},
  }
  const opened = await queryCodex({
    liveReads: true,
    binary: '/opt/homebrew/bin/codex',
    spawn() { spawned += 1; return child },
    stop(value) { stopped.push(value) },
  })
  assert.equal(spawned, 1)
  assert.equal(stopped.length, 1)
  assert.match(writes.join(''), /account\/rateLimits\/read/)
  assert.equal(opened.ok, false)
})

test('codex transport reads the rate-limit response and then stops the child', async () => {
  const writes = []
  const stdout = new EventEmitter()
  const child = {
    stdin: {
      write(chunk) {
        writes.push(String(chunk))
        const message = JSON.parse(String(chunk))
        if (message.method === 'initialize') {
          stdout.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })}\n`))
        }
        if (message.method === 'account/rateLimits/read') {
          stdout.emit('data', Buffer.from(`${JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: { rateLimits: { primary: { usedPercent: 40, windowDurationMins: 300 }, secondary: null } },
          })}\n`))
        }
      },
      end() {},
    },
    stdout,
    once() {},
    kill() {},
  }
  const stopped = []
  const result = await queryCodex({
    liveReads: true,
    binary: '/opt/homebrew/bin/codex',
    spawn: () => child,
    stop(value) { stopped.push(value) },
  })
  assert.equal(result.ok, true)
  assert.equal(result.windows[0].usedRatio, 0.4)
  assert.equal(stopped.length, 1)
  assert.match(writes.map((line) => JSON.parse(line).method).join(','), /initialize,initialized,account\/rateLimits\/read/)
})

test('glm maps the official 5 hour token window and keeps MCP monthly off the rings', () => {
  const parsed = parseGlmQuota({
    data: {
      limits: [
        { type: 'TOKENS_LIMIT', percentage: 20 },
        { type: 'TIME_LIMIT', percentage: 50, currentValue: 3, usage: 10 },
        { type: 'SOMETHING_ELSE', percentage: 5 },
      ],
    },
  })
  assert.equal(parsed.windows[0].scope, 'model')
  assert.equal(parsed.windows[0].durationMs, 5 * 60 * 60 * 1000)
  assert.equal(parsed.windows[0].usedRatio, 0.2)
  assert.equal(parsed.windows[1].scope, 'tool')
  assert.equal(parsed.windows[1].durationMs, null)
  assert.equal(parsed.windows[1].quantity, 3)
  assert.equal(parsed.windows[1].limit, 10)
  assert.equal(parsed.windows[2].scope, 'unknown')
  assert.equal(parsed.windows[2].label, '未识别额度')
  assert.equal(JSON.stringify(parsed).includes('SOMETHING_ELSE'), false)
  const missing = parseGlmQuota({ data: {} })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'incomplete')
  const empty = parseGlmQuota({ data: { limits: [] } })
  assert.equal(empty.ok, false)
  assert.deepEqual(selectRings(parsed.windows).map((ring) => ring.caption), ['5小时'])
  assert.equal(scopeText('tool'), '工具（月额度）')
  assert.equal(remainingText(parsed.windows[2]), '95%')
  const bare = parseGlmQuota({ data: { limits: [{ type: 'TOKENS_LIMIT' }] } })
  assert.equal(remainingText(bare.windows[0]), '未知')
})

test('glm rejects success:false before consuming limits and never echoes the remote message', async () => {
  const withLimits = parseGlmQuota({
    success: false,
    msg: 'remote detail must not leak',
    data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 10 }] },
  })
  assert.equal(withLimits.ok, false)
  assert.equal(withLimits.code, 'glm-rejected')
  assert.equal('windows' in withLimits, false)
  assert.equal(JSON.stringify(withLimits).includes('remote detail'), false)

  const withoutLimits = parseGlmQuota({ success: false })
  assert.equal(withoutLimits.ok, false)
  assert.equal(withoutLimits.code, 'glm-rejected')

  let fetched = 0
  const queried = await queryGlm({
    liveReads: true,
    platform: 'zhipu',
    token: 'fixture-glm-token',
    fetch: async () => {
      fetched += 1
      return {
        status: 200,
        url: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
        headers: { get() { return null } },
        json: async () => ({
          success: false,
          msg: 'remote detail must not leak',
          data: { limits: [{ type: 'CREDIT_LIMIT', percentage: 2, currentValue: 280, usage: 10000, remaining: 9719 }] },
        }),
      }
    },
  })
  assert.equal(fetched, 1)
  assert.equal(queried.ok, false)
  assert.equal(queried.code, 'glm-rejected')
  assert.equal('windows' in queried, false)
  assert.equal(JSON.stringify(queried).includes('fixture-glm-token'), false)
  assert.equal(JSON.stringify(queried).includes('remote detail'), false)
})

test('glm keeps both CREDIT_LIMIT records as credits with only valid millisecond resets', () => {
  const parsed = parseGlmQuota({
    data: {
      limits: [
        {
          type: 'CREDIT_LIMIT',
          percentage: 0,
          currentValue: 0,
          usage: 2000,
          remaining: 2000,
          unit: null,
          number: 5,
          nextResetTime: null,
        },
        {
          type: 'CREDIT_LIMIT',
          percentage: 2,
          currentValue: 280,
          usage: 10000,
          remaining: 9719,
          unit: null,
          number: 1,
          nextResetTime: 1_794_541_841_984,
        },
      ],
    },
  })
  assert.equal(parsed.ok, true)
  assert.equal(parsed.windows.length, 2)
  const [free, used] = parsed.windows
  assert.equal(free.scope, 'credit')
  assert.equal(used.scope, 'credit')
  assert.equal(free.durationMs, null)
  assert.equal(free.usedRatio, 0)
  assert.deepEqual(free.credit, { currentValue: 0, usage: 2000, remaining: 2000 })
  assert.equal('quantity' in free, false)
  assert.equal('limit' in free, false)
  assert.equal('remainingCount' in free, false)
  assert.equal(free.resetsAt, null)
  assert.equal(free.id, 'glm-credit-0')
  assert.equal(used.id, 'glm-credit-1')
  assert.notEqual(free.label, used.label)
  assert.match(free.label, /周期未知/)
  assert.equal(used.usedRatio, 0.02)
  assert.deepEqual(used.credit, { currentValue: 280, usage: 10000, remaining: 9719 })
  assert.equal('quantity' in used, false)
  assert.equal('limit' in used, false)
  assert.equal('remainingCount' in used, false)
  assert.equal(used.resetsAt, 1_794_541_841_984)
  assert.equal(resetText(used), '2026-11-13T03:50:41.984Z')
  assert.equal(quantityText(used), 'currentValue 280，usage 10000，remaining 9719')
  assert.equal(scopeText(used.scope), '积分（周期未知）')
  assert.deepEqual(selectRings(parsed.windows), [])
  assert.equal('unit' in used, false)
  assert.equal(JSON.stringify(parsed).includes('number'), false)
})

test('glm CREDIT_LIMIT keeps invalid or missing nextResetTime unknown', () => {
  const parsed = parseGlmQuota({
    data: {
      limits: [
        { type: 'CREDIT_LIMIT', percentage: 1, nextResetTime: 1_794_541_841_984 },
        { type: 'CREDIT_LIMIT', percentage: 1, nextResetTime: 1_794_541_841 },
        { type: 'CREDIT_LIMIT', percentage: 1, nextResetTime: '1794541841984' },
        { type: 'CREDIT_LIMIT', percentage: 1, nextResetTime: -1 },
        { type: 'CREDIT_LIMIT', percentage: 1, nextResetTime: 0 },
        { type: 'CREDIT_LIMIT', percentage: 1, nextResetTime: Number.NaN },
        { type: 'CREDIT_LIMIT', percentage: 1 },
      ],
    },
  })
  assert.equal(parsed.windows.length, 7)
  assert.deepEqual(parsed.windows.map((window) => window.resetsAt), [
    1_794_541_841_984,
    null,
    null,
    null,
    null,
    null,
    null,
  ])
  assert.equal(quantityText(parsed.windows[0]), '未知')
})

test('glm credit resets stay inside Date bounds and old windows ignore nextResetTime', () => {
  const dateMax = 8_640_000_000_000_000
  const parsed = parseGlmQuota({
    data: {
      limits: [
        { type: 'CREDIT_LIMIT', percentage: 1, nextResetTime: 1e12 },
        { type: 'CREDIT_LIMIT', percentage: 1, nextResetTime: dateMax },
        { type: 'CREDIT_LIMIT', percentage: 1, nextResetTime: dateMax + 1 },
        { type: 'CREDIT_LIMIT', percentage: 1, nextResetTime: 1e20 },
        { type: 'CREDIT_LIMIT', percentage: 1, nextResetTime: 1e308 },
      ],
    },
  })
  assert.deepEqual(parsed.windows.map((window) => window.resetsAt), [1e12, dateMax, null, null, null])
  assert.equal(resetText(parsed.windows[1]), '+275760-09-13T00:00:00.000Z')
  const old = parseGlmQuota({
    data: {
      limits: [
        { type: 'TOKENS_LIMIT', percentage: 10, nextResetTime: 1_794_541_841_984, resetsAt: 1_700_000_000 },
        { type: 'TIME_LIMIT', percentage: 20, nextResetTime: 1_794_541_841_984, resetsAt: 1_700_000_000 },
      ],
    },
  })
  assert.equal(old.windows[0].resetsAt, 1_700_000_000_000)
  assert.equal(old.windows[1].resetsAt, 1_700_000_000_000)
  assert.equal(resetText(old.windows[0]), '2023-11-14T22:13:20.000Z')
})

test('glm query rejects other hosts and does not fetch without a token or live reads', async () => {
  assert.throws(() => assertGlmUrl('http://open.bigmodel.cn/api/monitor/usage/quota/limit'), /允许名单/)
  assert.throws(() => assertGlmUrl('https://evil.example/api/monitor/usage/quota/limit'), /允许名单/)
  assert.throws(() => assertGlmUrl('https://dev.bigmodel.cn/api/monitor/usage/quota/limit'), /允许名单/)
  let fetched = 0
  const fetch = async () => { fetched += 1; throw new Error('should not fetch') }
  assert.equal((await queryGlm({ liveReads: true, platform: 'zhipu', fetch })).code, 'needs-key')
  assert.equal((await queryGlm({ liveReads: false, platform: 'zai', hasToken: true, token: 'stored-token-value', fetch })).code, 'live-reads-disabled')
  assert.equal(fetched, 0)
  const calls = []
  const ok = await queryGlm({
    liveReads: true,
    platform: 'zai',
    token: 'stored-token-value',
    fetch: async (url, init) => {
      calls.push({ url, authorization: init.headers.Authorization })
      return {
        status: 200,
        headers: { get() { return null } },
        json: async () => ({ data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 10 }] } }),
      }
    },
  })
  assert.equal(ok.windows[0].usedRatio, 0.1)
  assert.equal(calls[0].url, 'https://api.z.ai/api/monitor/usage/quota/limit')
  assert.equal(calls[0].authorization, 'stored-token-value')
  assert.equal(calls[0].authorization.startsWith('Bearer '), false)
  const limited = await queryGlm({
    liveReads: true,
    platform: 'zhipu',
    token: 'stored-token-value',
    fetch: async () => ({ status: 429, headers: { get: (name) => name.toLowerCase() === 'retry-after' ? '12' : null }, json: async () => ({}) }),
  })
  assert.equal(limited.code, 'rate-limited')
  assert.equal(limited.retryAfterMs, 12000)
  assert.equal(JSON.stringify(limited).includes('stored-token-value'), false)
})

test('glm refuses redirects and an unusable Retry-After waits 15 minutes', async () => {
  let readBody = false
  const redirected = await queryGlm({
    liveReads: true,
    platform: 'zhipu',
    token: 'fixture-glm-token',
    fetch: async (_url, init) => {
      assert.equal(init.redirect, 'error')
      return {
        status: 200,
        url: 'https://evil.example/api/monitor/usage/quota/limit',
        headers: { get() { return null } },
        json: async () => { readBody = true; return {} },
      }
    },
  })
  assert.equal(redirected.code, 'glm-host-rejected')
  assert.equal(readBody, false)
  assert.equal(JSON.stringify(redirected).includes('fixture-glm-token'), false)
  const invalid = await queryGlm({
    liveReads: true,
    platform: 'zai',
    token: 'fixture-glm-token',
    fetch: async () => ({
      status: 429,
      url: 'https://api.z.ai/api/monitor/usage/quota/limit',
      headers: { get: () => 'nope' },
      json: async () => ({}),
    }),
  })
  assert.equal(invalid.retryAfterMs, CONSERVATIVE_RETRY_MS)
  assert.equal(invalid.retryAfterInvalid, true)
  assert.equal(JSON.stringify(invalid).includes('nope'), false)
})

test('codex uses a fixed absolute path, settles on abort and close, and kills the group', async () => {
  const winEnv = { LOCALAPPDATA: 'C:\\Users\\fixture\\AppData\\Local' }
  assert.equal(
    resolveCodexBinary((candidate) => candidate === 'C:\\Users\\fixture\\AppData\\Local\\Programs\\codex\\codex.exe', 'win32', winEnv),
    'C:\\Users\\fixture\\AppData\\Local\\Programs\\codex\\codex.exe',
  )
  assert.equal(resolveCodexBinary(() => true, 'win32', {}), null)
  assert.equal(resolveCodexBinary((candidate) => candidate === '/usr/local/bin/codex', 'darwin'), '/usr/local/bin/codex')
  const rejected = await queryCodex({
    liveReads: true,
    binary: 'codex',
    spawn() { throw new Error('spawned') },
  })
  assert.equal(rejected.code, 'codex-binary-missing')

  const kills = []
  stopChild({
    pid: 424242,
    stdin: { end() {} },
    kill(signal) { kills.push(['child', signal]) },
  }, (pid, signal) => kills.push(['group', pid, signal]))
  assert.deepEqual(kills, [['group', -424242, 'SIGTERM'], ['child', 'SIGTERM']])

  const sentinel = 'should-not-pass'
  process.env.QUOTA_RINGS_SENTINEL = sentinel
  const stdout = new EventEmitter()
  const child = {
    pid: 424242,
    stdin: { write() {}, end() {} },
    stdout,
    once() {},
    kill() {},
  }
  let options
  const ac = new AbortController()
  const aborted = await queryCodex({
    liveReads: true,
    binary: '/opt/homebrew/bin/codex',
    signal: ac.signal,
    timeoutMs: 5000,
    spawn(_command, _args, init) {
      options = init
      ac.abort()
      return child
    },
    stop() {},
  })
  delete process.env.QUOTA_RINGS_SENTINEL
  assert.equal(aborted.code, 'aborted')
  assert.equal(options.detached, process.platform !== 'win32')
  assert.equal(options.env.QUOTA_RINGS_SENTINEL, undefined)
  assert.equal(Object.hasOwn(options.env, 'QUOTA_RINGS_SENTINEL'), false)

  const closedOut = new EventEmitter()
  const closed = await queryCodex({
    liveReads: true,
    binary: '/usr/local/bin/codex',
    timeoutMs: 5000,
    spawn() {
      queueMicrotask(() => closedOut.emit('close'))
      return { pid: 7, stdin: { write() {}, end() {} }, stdout: closedOut, once() {}, kill() {} }
    },
    stop() {},
  })
  assert.equal(closed.code, 'codex-failed')
  assert.match(closed.message, /输出已关闭/)

  const winOut = new EventEmitter()
  let winCommand = null
  let winOptions = null
  const windows = await queryCodex({
    liveReads: true,
    binary: 'C:\\Users\\fixture\\AppData\\Local\\Programs\\codex\\codex.exe',
    platform: 'win32',
    timeoutMs: 5000,
    spawn(command, _args, init) {
      winCommand = command
      winOptions = init
      queueMicrotask(() => winOut.emit('close'))
      return { pid: 8, stdin: { write() {}, end() {} }, stdout: winOut, once() {}, kill() {} }
    },
    stop() {},
  })
  assert.equal(windows.code, 'codex-failed')
  assert.equal(winCommand, 'C:\\Users\\fixture\\AppData\\Local\\Programs\\codex\\codex.exe')
  assert.equal(winOptions.detached, false)
  assert.equal(winOptions.env.SYSTEMROOT, undefined)
})

test('windows cmd shims use fixed cmd.exe, a node directory, and safe quoting', () => {
  const cmdPath = 'C:\\Users\\张三\\AppData\\Roaming\\npm\\codex.cmd'
  const localNode = 'C:\\Users\\张三\\AppData\\Roaming\\npm\\node.exe'
  const exists = (candidate) => candidate === localNode || candidate === 'C:\\Program Files\\nodejs\\node.exe'
  const env = { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', HOME: 'C:\\Users\\张三' }
  const plan = codexSpawnPlan(cmdPath, ['app-server'], 'win32', env, exists)
  assert.equal(plan.command, 'C:\\Windows\\System32\\cmd.exe')
  assert.deepEqual(plan.args, ['/d', '/s', '/v:off', '/c', `""${cmdPath}" app-server"`])
  assert.equal(plan.windowsVerbatimArguments, true)
  const childEnv = codexChildEnv(env, 'win32', exists, 'C:\\Users\\张三\\AppData\\Roaming\\npm')
  assert.ok(childEnv.PATH.includes('C:\\Users\\张三\\AppData\\Roaming\\npm'))
  assert.ok(childEnv.PATH.includes('C:\\Program Files\\nodejs'))
  assert.equal(childEnv.ComSpec, 'C:\\Windows\\System32\\cmd.exe')
  assert.equal(codexSpawnPlan(cmdPath, ['app-server'], 'win32', { SystemRoot: 'C:\\Windows' }, () => false).error, 'codex-node-missing')
  assert.equal(codexSpawnPlan('C:\\bad"path\\codex.cmd', ['app-server'], 'win32', env, exists).error, 'codex-unsafe-path')
  assert.equal(codexSpawnPlan('C:\\codex.exe', ['app-server'], 'win32', env, exists).command, 'C:\\codex.exe')
})

test('codex cmd query spawns via cmd.exe with node on PATH and settles on close', async () => {
  const cmdPath = 'C:\\Users\\张三\\AppData\\Roaming\\npm\\codex.cmd'
  const exists = (candidate) => candidate === 'C:\\Users\\张三\\AppData\\Roaming\\npm\\node.exe'
  let seen = null
  const stdout = new EventEmitter()
  const result = await queryCodex({
    liveReads: true,
    binary: cmdPath,
    platform: 'win32',
    timeoutMs: 5000,
    exists,
    spawn(command, args, init) {
      seen = { command, args, init }
      queueMicrotask(() => stdout.emit('close'))
      return { pid: 9, stdin: { write() {}, end() {} }, stdout, once() {}, kill() {} }
    },
    stop() {},
  })
  assert.equal(result.code, 'codex-failed')
  assert.equal(seen.command, 'C:\\Windows\\System32\\cmd.exe')
  assert.deepEqual(seen.args.slice(0, 4), ['/d', '/s', '/v:off', '/c'])
  assert.equal(seen.args[4], `""${cmdPath}" app-server"`)
  assert.equal(seen.init.windowsVerbatimArguments, true)
  assert.equal(seen.init.detached, false)
  assert.ok(seen.init.env.PATH.includes('C:\\Users\\张三\\AppData\\Roaming\\npm'))
})

test('claude and opencode stay closed without live reads and grok is unread rather than success', async () => {
  const claude = await queryClaude()
  const opencode = await queryOpenCode()
  const grok = queryGrok()
  assert.equal(claude.ok, false)
  assert.equal(claude.experimental, true)
  assert.equal(claude.code, 'live-reads-disabled')
  assert.equal(opencode.ok, false)
  assert.equal(opencode.experimental, true)
  assert.equal(opencode.code, 'live-reads-disabled')
  assert.equal(grok.unread, true)
  assert.equal(grok.link.href, 'https://grok.com')
})

test('glm rejects CR/LF in headers before send and does not leak the token', async () => {
  let fetched = 0
  const injected = await queryGlm({
    liveReads: true,
    platform: 'zhipu',
    token: 'line\r\ninject',
    fetch: async () => { fetched += 1; throw new Error('should not fetch') },
  })
  assert.equal(injected.code, 'unsafe-header')
  assert.equal(fetched, 0)
  assert.equal(JSON.stringify(injected).includes('line'), false)
})

test('codex success removes the abort listener that was registered', async () => {
  const added = []
  const removed = []
  const signal = {
    aborted: false,
    addEventListener(type, fn) { added.push({ type, fn }) },
    removeEventListener(type, fn) { removed.push({ type, fn }) },
  }
  const stdout = new EventEmitter()
  const child = {
    stdin: {
      write(chunk) {
        const message = JSON.parse(String(chunk))
        if (message.method === 'initialize') {
          stdout.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })}\n`))
        }
        if (message.method === 'account/rateLimits/read') {
          stdout.emit('data', Buffer.from(`${JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: { rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300 } } },
          })}\n`))
        }
      },
      end() {},
    },
    stdout,
    once() {},
    kill() {},
  }
  const result = await queryCodex({
    liveReads: true,
    binary: '/opt/homebrew/bin/codex',
    signal,
    spawn: () => child,
    stop() {},
  })
  assert.equal(result.ok, true)
  assert.equal(added.length, 1)
  assert.equal(removed.some((item) => item.fn === added[0].fn), true)
})

test('claude experimental adapter maps five_hour and seven_day from an injected query', async () => {
  const parsed = parseClaudeUsage({
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 25, resets_at: '2026-11-12T12:00:00.000Z' },
      seven_day: { percent: 40 },
    },
  })
  assert.equal(parsed.ok, true)
  assert.equal(parsed.experimental, true)
  assert.equal(parsed.windows[0].usedRatio, 0.25)
  assert.equal(parsed.windows[1].usedRatio, 0.4)
  assert.deepEqual(selectRings(parsed.windows).map((ring) => ring.caption), ['5小时', '1周'])
  const closed = []
  const live = await queryClaude({
    liveReads: true,
    queryFactory() {
      return {
        [CLAUDE_USAGE_METHOD]() {
          return {
            rate_limits_available: true,
            rate_limits: { five_hour: { utilization: 20 } },
          }
        },
        close() { closed.push(true) },
      }
    },
  })
  assert.equal(live.ok, true)
  assert.equal(live.windows[0].usedRatio, 0.2)
  assert.equal(closed.length, 1)
  const missing = await queryClaude({
    liveReads: true,
    importSdk: async () => { throw new Error('no sdk') },
  })
  assert.equal(missing.code, 'sdk-missing')
  assert.match(missing.message, /claude-client.ts/)
  assert.match(missing.message, /0\.3\.309/)
})

test('claude and opencode percent fields are 0-100 and are never guessed as ratios', () => {
  const claude = [0, 0.2, 1, 25, 100, -1, 101].map((value) => {
    const parsed = parseClaudeUsage({
      rate_limits_available: true,
      rate_limits: { five_hour: { percent: value } },
    })
    return parsed.windows?.[0]?.usedRatio ?? null
  })
  assert.deepEqual(claude, [0, 0.002, 0.01, 0.25, 1, null, null])
  const opencode = [0, 0.2, 1, 25, 100, -1, 101].map((value) => {
    const parsed = parseOpenCodeUsage({
      usage: { rolling: { percent: value } },
    })
    return parsed.windows?.[0]?.usedRatio ?? null
  })
  assert.deepEqual(opencode, [0, 0.002, 0.01, 0.25, 1, null, null])
})

test('opencode experimental adapter keeps the allowlist, monthly as a tool, and does not read secrets', async () => {
  assert.throws(() => assertOpenCodeUrl('https://evil.example/zen/go/v1/usage'))
  const parsed = parseOpenCodeUsage({
    usage: {
      rolling: { percent: 10, resetsAt: '2026-11-12T12:00:00.000Z' },
      weekly: { percent: 20 },
      monthly: { percent: 30 },
    },
  })
  assert.equal(parsed.windows[0].scope, 'model')
  assert.equal(parsed.windows[1].scope, 'model')
  assert.equal(parsed.windows[2].scope, 'tool')
  assert.deepEqual(selectRings(parsed.windows).map((ring) => ring.caption), ['5小时', '1周'])
  let fetched = 0
  const noKey = await queryOpenCode({
    liveReads: true,
    fetch: async () => { fetched += 1; throw new Error('should not fetch') },
  })
  assert.equal(noKey.code, 'needs-key')
  assert.equal(fetched, 0)
  const injected = await queryOpenCode({
    liveReads: true,
    token: 'fixture-opencode-token\r\nX-Injected: yes',
    fetch: async () => { fetched += 1; throw new Error('should not fetch') },
  })
  assert.equal(injected.code, 'unsafe-header')
  assert.equal(fetched, 0)
  const calls = []
  const ok = await queryOpenCode({
    liveReads: true,
    token: 'fixture-opencode-token',
    fetch: async (url, init) => {
      calls.push({ url, redirect: init.redirect, authorization: init.headers.Authorization })
      return {
        status: 200,
        url,
        json: async () => ({ usage: { rolling: { percent: 15 }, weekly: { percent: 25 } } }),
      }
    },
  })
  assert.equal(ok.windows[0].usedRatio, 0.15)
  assert.equal(calls[0].url, 'https://opencode.ai/zen/go/v1/usage')
  assert.equal(calls[0].redirect, 'error')
  assert.equal(calls[0].authorization, 'Bearer fixture-opencode-token')
  assert.equal(JSON.stringify(ok).includes('fixture-opencode-token'), false)
  const redirected = await queryOpenCode({
    liveReads: true,
    token: 'fixture-opencode-token',
    fetch: async () => ({
      status: 200,
      url: 'https://evil.example/zen/go/v1/usage',
      json: async () => ({ usage: { rolling: { percent: 1 } } }),
    }),
  })
  assert.equal(redirected.code, 'opencode-host-rejected')
})
