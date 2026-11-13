import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const helper = fileURLToPath(new URL('../bin/quota-keychain', import.meta.url))
const available = process.platform === 'darwin' && process.arch === 'arm64' && existsSync(helper)
const skip = available ? false : 'compiled arm64 helper is not present'

test('keychain helper ping does not need caller identity and never returns a secret', { skip }, () => {
  const result = spawnSync(helper, [], { input: '{"op":"ping"}\n', encoding: 'utf8' })
  assert.equal(result.status, 0)
  const payload = JSON.parse(result.stdout.trim())
  assert.equal(payload.ok, true)
  assert.equal(payload.op, 'ping')
  assert.equal(Object.hasOwn(payload, 'secret'), false)
  assert.match(result.stderr, /"audit":"quota-keychain"/)
})

test('keychain helper accepts a request exactly at the 16 KiB boundary', { skip }, () => {
  const base = '{"op":"ping","pad":""}'
  const boundary = `{"op":"ping","pad":"${'x'.repeat(16 * 1024 - Buffer.byteLength(base))}"}`
  assert.equal(Buffer.byteLength(boundary), 16 * 1024)
  const result = spawnSync(helper, [], { input: boundary, encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.equal(JSON.parse(result.stdout.trim()).ok, true)
})

test('keychain helper rejects over-limit input without waiting for EOF', { skip }, async () => {
  const child = spawn(helper, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdin.on('error', () => {})
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const closed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('helper waited for EOF before rejecting oversized input'))
    }, 1500)
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
  child.stdin.write(Buffer.alloc(16 * 1024 + 1, 0x20))
  const code = await closed
  assert.equal(code, 1)
  assert.match(stdout, /bad-request/)
  assert.doesNotMatch(stdout, /secret/i)
  assert.match(stderr, /"audit":"quota-keychain"/)
})
