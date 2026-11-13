import test from 'node:test'
import assert from 'node:assert/strict'
import { createSecretStore, GLM_ACCOUNT, OPENCODE_ACCOUNT } from '../src/secrets.js'

function fakeStore(stdout) {
  const calls = []
  const runner = async (call) => {
    calls.push(call)
    return { code: 0, stdout: JSON.stringify(stdout), stderr: '', args: call.args }
  }
  return { calls, store: createSecretStore({ runner, platform: 'darwin', arch: 'arm64', helperPath: '/fixture/helper' }) }
}

test('the macOS secret store accepts only the plugin keychain accounts before spawning', async () => {
  const { calls, store } = fakeStore({ ok: true })
  const rejected = await store.get('other-plugin')
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'account-not-allowed')
  assert.equal(calls.length, 0)

  const glm = await store.get(GLM_ACCOUNT)
  assert.equal(glm.ok, false)
  assert.equal(glm.code, 'keychain-failed')
  assert.equal(calls.length, 1)
  const payload = JSON.parse(calls[0].stdin)
  assert.equal(payload.service, 'dsh-provider-quota-rings')
  assert.equal(payload.account, GLM_ACCOUNT)
  assert.equal(calls[0].args.includes('fixture-secret'), false)

  const opencode = await store.set(OPENCODE_ACCOUNT, 'fixture-secret')
  assert.equal(opencode.ok, true)
  assert.equal(calls[1].args.includes('fixture-secret'), false)
})

test('a get may return the keychain secret but set and delete may not echo it', async () => {
  const got = fakeStore({ ok: true, secret: 'fixture-secret' })
  const value = await got.store.get(GLM_ACCOUNT)
  assert.deepEqual(value, { ok: true, secret: 'fixture-secret' })
  assert.equal(callsLeak(got.calls, 'fixture-secret'), false)

  const set = fakeStore({ ok: true, secret: 'fixture-secret' })
  const stored = await set.store.set(OPENCODE_ACCOUNT, 'fixture-secret')
  assert.equal(stored.code, 'secret-in-output')
  assert.equal(callsLeak(set.calls, 'fixture-secret'), false)

  const deletion = fakeStore({ ok: true })
  const deleted = await deletion.store.delete(OPENCODE_ACCOUNT)
  assert.equal(deleted.ok, true)
  assert.equal(callsLeak(deletion.calls, 'fixture-secret'), false)
})

function callsLeak(calls, secret) {
  return calls.some((call) => call.args.some((arg) => String(arg).includes(secret)))
}
