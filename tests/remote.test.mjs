import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  QUOTA_REMOTE_IDS,
  REMOTE_METHOD_MARKER,
  registerQuotaRemote,
  stripSecrets,
} from '../src/remote.js'

function parameterNames(fn) {
  const source = Function.prototype.toString.call(fn)
  const open = source.indexOf('(')
  const close = source.indexOf(')', open + 1)
  const body = source.slice(open + 1, close).trim()
  if (!body) return []
  return body.split(',').map((part) => part.trim())
}

test('an empty session can read the remote and the read does not call commands.execute', async () => {
  const commandLog = []
  const saved = []
  const now = 1_700_000_000_000
  const service = {
    snapshot() {
      return {
        glmPlatform: 'zhipu',
        liveReads: false,
        glmKeyStored: false,
        opencodeKeyStored: false,
        token: 'must-not-leak',
        byId: {
          codex: {
            status: 'stale',
            updatedAt: now,
            error: '超时',
            windows: [
              { label: '短', scope: 'model', durationMs: 5 * 60 * 60 * 1000, usedRatio: 0.38, resetsAt: now + (3 * 60 + 5) * 60 * 1000 },
              { label: '长', scope: 'model', durationMs: 7 * 24 * 60 * 60 * 1000, usedRatio: 0.2 },
              { label: 'MCP', scope: 'tool', quantity: 3, limit: 10 },
            ],
          },
        },
      }
    },
    async refreshOne() { commandLog.push('refresh') },
    async refreshAll() { commandLog.push('refresh-all') },
    async setDisabled() {},
    setGlmPlatform() {},
    async storeGlmToken(secret) {
      saved.push(secret)
      return { ok: true }
    },
    async storeOpenCodeToken(secret) {
      saved.push(secret)
      return { ok: true }
    },
  }
  const provided = []
  const commands = { execute() { commandLog.push('commands.execute') } }
  const { remote, dispose } = registerQuotaRemote({
    commands,
    reflect: {
      provide(name, value) {
        provided.push({ name, value })
        return () => { provided.disposed = true }
      },
    },
  }, service, () => now)

  assert.equal(provided[0].name, 'quotaRings')
  assert.equal(provided[0].value, remote)
  assert.equal(remote.typertRemote.service, remote)
  assert.equal(remote.typertRemote.serviceKey, 'quotaRings')
  assert.equal(remote.typertRemote.namespace, 'quotaRings')
  const marker = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(remote), REMOTE_METHOD_MARKER).value
  assert.equal(marker.version, 1)
  assert.deepEqual(marker.methods.map((item) => item.method), ['read', 'refresh', 'setDisabled', 'setPlatform', 'storeGlmKey', 'storeOpenCodeKey', 'setLiveReads'])
  for (const item of marker.methods) assert.equal(item.invocation.kind, 'direct')
  const proto = Object.getPrototypeOf(remote)
  assert.deepEqual(parameterNames(proto.read), ['signal'])
  assert.equal(parameterNames(proto.refresh).at(-1), 'signal')
  assert.equal(parameterNames(proto.storeGlmKey).includes('session'), false)
  assert.equal(parameterNames(proto.storeOpenCodeKey).includes('session'), false)

  const dto = remote.read(new AbortController().signal)
  assert.deepEqual(commandLog, [])
  assert.equal(JSON.stringify(dto).includes('must-not-leak'), false)
  assert.equal(JSON.stringify(dto).includes('token'), false)
  const row = dto.rows.find((item) => item.id === 'codex')
  assert.equal(row.windows.length, 3)
  assert.equal(row.rings.length, 2)
  assert.equal(row.windows[0].resetDistanceText, '3 小时 5 分')
  assert.equal(row.windows[0].remainingText, '62%')
  assert.equal(row.windows[1].resetDistanceText, '未知')
  assert.equal(row.windows[2].scopeText, '工具（月额度）')
  assert.equal(row.windows[2].showQuantity, true)
  assert.equal(row.windows[2].quantityText, '3/10')
  assert.match(row.statusText, /数据较旧/)

  const stored = await remote.storeGlmKey('fixture-secret', new AbortController().signal)
  assert.equal(stored.ok, true)
  assert.equal(saved[0], 'fixture-secret')
  assert.equal(JSON.stringify(stored).includes('fixture-secret'), false)
  const storedOpenCode = await remote.storeOpenCodeKey('fixture-opencode-secret', new AbortController().signal)
  assert.equal(storedOpenCode.ok, true)
  assert.equal(saved[1], 'fixture-opencode-secret')
  assert.equal(JSON.stringify(storedOpenCode).includes('fixture-opencode-secret'), false)
  assert.deepEqual(commandLog, [])

  const aborted = new AbortController()
  aborted.abort()
  assert.throws(() => remote.read(aborted.signal))
  dispose()
  assert.equal(provided.disposed, true)

  const client = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  for (const id of Object.values(QUOTA_REMOTE_IDS)) assert.equal(client.includes(id), true)
  assert.equal(client.includes('commands.execute'), false)

  const stripped = JSON.stringify(stripSecrets({
    note: 'ok',
    Token: 'hidden-token',
    AUTHORIZATION: 'hidden-auth',
    glmKey: 'hidden-glm',
    api_key: 'hidden-api',
  }))
  assert.equal(stripped.includes('hidden-token'), false)
  assert.equal(stripped.includes('hidden-auth'), false)
  assert.equal(stripped.includes('hidden-glm'), false)
  assert.equal(stripped.includes('hidden-api'), false)
  assert.match(stripped, /ok/)
})
