import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { apply } from '../index.js'
import { createSecretStore } from '../src/secrets.js'

test('host command does not record input and never spawns while live reads are off', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'quota-rings-host-'))
  const registered = []
  const cleanups = []
  const timers = []
  const power = []
  const ctx = {
    inject(_names, applyScope) {
      applyScope({
        get() {
          return {
            register(definition) {
              registered.push(definition)
              return () => {}
            },
          }
        },
        effect(callback) { cleanups.push(callback()) },
      })
    },
    effect(callback) { cleanups.push(callback()) },
    on(name, fn) {
      power.push({ name, fn })
      return () => { power.released = true }
    },
  }
  const stop = apply(ctx, {
    dataDir: dir,
    setTimer(fn, ms) {
      const id = timers.length + 1
      timers.push({ id, fn, ms })
      return id
    },
    clearTimer(id) {
      const index = timers.findIndex((item) => item.id === id)
      if (index >= 0) timers.splice(index, 1)
    },
    spawn() { throw new Error('spawned') },
    fetchImpl() { throw new Error('fetched') },
    secretRunner() { throw new Error('secret runner called') },
    stopChild() {},
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'quota-rings')
  assert.equal(registered[0].recordInput, false)
  assert.equal(timers.length, 1)
  assert.equal(timers[0].ms, 300000)
  assert.equal(power[0].name, 'dsh/power')
  const shown = await registered[0].handler({ rawInput: '' })
  assert.equal(shown.kind, 'success')
  const body = JSON.parse(shown.text)
  assert.deepEqual(body.rows.map((row) => row.id), ['codex', 'claude', 'opencode', 'grok', 'glm'])
  assert.equal(body.rows.find((row) => row.id === 'grok').status, 'unread')
  assert.equal(body.rows.find((row) => row.id === 'codex').status, 'unknown')
  assert.equal(body.liveReads, false)
  assert.equal(body.exampleData, false)
  stop()
  for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup()
  assert.equal(timers.length, 0)
  assert.equal(power.released, true)
  await fs.rm(dir, { recursive: true, force: true })
})

test('missing keychain helper does not write a plaintext secret', async () => {
  let called = false
  const store = createSecretStore({
    platform: 'darwin',
    helperPath: null,
    runner() { called = true },
  })
  const result = await store.set('glm', 'super-secret-value')
  assert.equal(result.code, 'keychain-helper-not-built')
  assert.equal(called, false)
  assert.equal(JSON.stringify(result).includes('super-secret-value'), false)
})

test('darwin helper refuses a non-arm64 Mac before launch', async () => {
  let called = false
  const store = createSecretStore({
    platform: 'darwin',
    arch: 'x64',
    helperPath: '/tmp/quota-keychain',
    runner() { called = true },
  })
  const result = await store.get('glm')
  assert.equal(result.code, 'keychain-helper-unsupported-arch')
  assert.equal(called, false)
})

test('the default apply path uses global fetch for GLM and keeps the fixture token out of the command text', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'quota-rings-host-'))
  const token = 'fixture-glm-token'
  await fs.writeFile(path.join(dir, 'settings.json'), `${JSON.stringify({
    disabled: {},
    glmPlatform: 'zhipu',
    liveReads: true,
    glmKeyStored: true,
  }, null, 2)}\n`)
  const registered = []
  const fetches = []
  const spawns = []
  const previous = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    fetches.push({ url, redirect: init?.redirect, authorization: init?.headers?.Authorization })
    return {
      url,
      status: 200,
      async json() { return { limits: [] } },
    }
  }
  const ctx = {
    inject(_names, applyScope) {
      applyScope({
        get() {
          return { register(definition) { registered.push(definition); return () => {} } }
        },
        effect(callback) { callback() },
      })
    },
    effect(callback) { callback() },
  }
  let stop = () => {}
  try {
    stop = apply(ctx, {
      dataDir: dir,
      liveReads: true,
      setTimer() { return 1 },
      clearTimer() {},
      stopChild() {},
      spawn(command) {
        spawns.push(command)
        const child = new EventEmitter()
        child.stdout = new EventEmitter()
        child.stderr = new EventEmitter()
        child.stdin = { write() {}, end() {} }
        child.kill = () => {}
        queueMicrotask(() => child.emit('error', new Error('fixture codex transport')))
        return child
      },
      secretRunner: async () => ({
        code: 0,
        stdout: `${JSON.stringify({ ok: true, op: 'get', secret: token })}\n`,
        args: [],
        stderr: '',
      }),
    })
    for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve))
    assert.equal(fetches.length, 1)
    assert.equal(fetches[0].url, 'https://open.bigmodel.cn/api/monitor/usage/quota/limit')
    assert.equal(fetches[0].redirect, 'error')
    assert.equal(fetches[0].authorization, token)
    assert.equal(spawns.length, 1)
    assert.equal(spawns[0].startsWith('/'), true)
    const shown = await registered[0].handler({ rawInput: '' })
    assert.equal(shown.text.includes(token), false)
    assert.equal((await fs.readFile(path.join(dir, 'settings.json'), 'utf8')).includes(token), false)
  } finally {
    globalThis.fetch = previous
    stop()
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('OpenCode Go reads its key from the secret runner, not from plain config', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'quota-rings-host-'))
  const token = 'fixture-opencode-token'
  await fs.writeFile(path.join(dir, 'settings.json'), `${JSON.stringify({
    disabled: {},
    glmPlatform: 'zhipu',
    liveReads: true,
    glmKeyStored: false,
    opencodeKeyStored: true,
  }, null, 2)}\n`)
  const registered = []
  const fetches = []
  const previous = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    fetches.push({ url, redirect: init?.redirect, authorization: init?.headers?.Authorization })
    return {
      url,
      status: 200,
      async json() { return { usage: { rolling: { percent: 15 }, weekly: { percent: 25 } } } },
    }
  }
  const ctx = {
    inject(_names, applyScope) {
      applyScope({
        get() {
          return { register(definition) { registered.push(definition); return () => {} } }
        },
        effect(callback) { callback() },
      })
    },
    effect(callback) { callback() },
  }
  let stop = () => {}
  try {
    stop = apply(ctx, {
      dataDir: dir,
      liveReads: true,
      setTimer() { return 1 },
      clearTimer() {},
      stopChild() {},
      spawn() {
        const child = new EventEmitter()
        child.stdout = new EventEmitter()
        child.stderr = new EventEmitter()
        child.stdin = { write() {}, end() {} }
        child.kill = () => {}
        queueMicrotask(() => child.emit('error', new Error('fixture codex transport')))
        return child
      },
      secretRunner: async () => ({
        code: 0,
        stdout: `${JSON.stringify({ ok: true, op: 'get', secret: token })}\n`,
        args: [],
        stderr: '',
      }),
    })
    for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve))
    const opencode = fetches.find((item) => item.url === 'https://opencode.ai/zen/go/v1/usage')
    assert.ok(opencode)
    assert.equal(opencode.redirect, 'error')
    assert.equal(opencode.authorization, `Bearer ${token}`)
    const shown = await registered[0].handler({ rawInput: '' })
    assert.equal(shown.text.includes(token), false)
    assert.equal((await fs.readFile(path.join(dir, 'settings.json'), 'utf8')).includes(token), false)
  } finally {
    globalThis.fetch = previous
    stop()
    await fs.rm(dir, { recursive: true, force: true })
  }
})
