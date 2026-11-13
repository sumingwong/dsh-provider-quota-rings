import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createHostCredentials,
  hostCredentialKey,
  pickHostRecordKey,
  referenceCandidates,
  referenceForRoute,
  secretFromRecord,
} from '../src/credentials.js'

const OPENCODE = /opencode/i
const GLM = /zhipu|bigmodel|z-?ai|\bglm\b/i

test('a route id derives the host reference name', () => {
  assert.equal(referenceForRoute('opencode-go'), 'OPENCODE_GO_API_KEY')
  assert.equal(referenceForRoute('strata'), 'STRATA_API_KEY')
  assert.equal(referenceForRoute(''), null)
})

test('candidates put route-derived names before aliases', () => {
  const names = referenceCandidates('opencode', ['opencode-go'])
  assert.equal(names[0], 'OPENCODE_GO_API_KEY')
  assert.ok(names.includes('OPENCODE_API_KEY'))
  for (const name of referenceCandidates('glm', ['glm-4.6'])) assert.match(name, /^[A-Z0-9_]+$/)
})

test('host credential keys use the LLM scope and the route id', () => {
  assert.equal(hostCredentialKey('opencode-go'), 'llm-pi-ai/opencode-go')
})

test('only api-key records in the llm scope match', () => {
  const entries = [
    { key: 'llm-pi-ai/opencode-go', kind: 'api-key' },
    { key: 'llm-pi-ai/opencode-oauth', kind: 'grant' },
    { key: 'other-plugin/opencode-go', kind: 'api-key' },
  ]
  assert.equal(pickHostRecordKey(entries, OPENCODE), 'llm-pi-ai/opencode-go')
  assert.equal(pickHostRecordKey(entries, GLM), null)
  assert.equal(pickHostRecordKey(entries, null), null)
  assert.equal(pickHostRecordKey(null, OPENCODE), null)
})

test('a record secret is the key, else the provider environment value', () => {
  assert.equal(secretFromRecord({ kind: 'api-key', key: 'sk-live' }), 'sk-live')
  assert.equal(secretFromRecord({ kind: 'api-key', env: { OPENCODE_GO_API_KEY: 'sk-env' } }), 'sk-env')
  assert.equal(secretFromRecord({ kind: 'api-key', key: '', env: {} }), null)
  assert.equal(secretFromRecord({ kind: 'grant', payload: { token: 'x' } }), null)
  assert.equal(secretFromRecord(null), null)
})

function hostContext({ refs = {}, entries = [], records = {} } = {}) {
  return {
    get(name) {
      if (name !== 'credentials') return undefined
      return {
        resolve: async (ref) => (ref in refs ? { value: refs[ref], source: 'file' } : undefined),
        listRecords: async () => entries,
        readRecord: async (key) => records[key],
      }
    },
  }
}

const routes = () => ['opencode-go', 'strata', 'agentspace']

test('the route reference wins, so a configured chat route needs no second key', async () => {
  const ctx = hostContext({ refs: { OPENCODE_GO_API_KEY: 'sk-host' } })
  const host = createHostCredentials(ctx, { routes })
  assert.equal(await host.find({ provider: 'opencode', pattern: OPENCODE }), 'sk-host')
})

test('an alias is used when the route-derived reference is unset', async () => {
  const ctx = hostContext({ refs: { OPENCODE_API_KEY: 'sk-alias' } })
  const host = createHostCredentials(ctx, { routes })
  assert.equal(await host.find({ provider: 'opencode', pattern: OPENCODE }), 'sk-alias')
})

test('a route outside the pattern never asks for a reference', async () => {
  const asked = []
  const ctx = {
    get: () => ({
      resolve: async (ref) => { asked.push(ref); return undefined },
      listRecords: async () => [],
      readRecord: async () => undefined,
    }),
  }
  const host = createHostCredentials(ctx, { routes: () => ['strata'] })
  assert.equal(await host.find({ provider: 'opencode', pattern: OPENCODE }), null)
  assert.deepEqual(asked, ['OPENCODE_API_KEY', 'OPENCODE_ZEN_API_KEY'])
})

test('an api-key record is read when no reference is set', async () => {
  const ctx = hostContext({
    entries: [{ key: 'llm-pi-ai/opencode-go', kind: 'api-key' }],
    records: { 'llm-pi-ai/opencode-go': { kind: 'api-key', key: 'sk-record' } },
  })
  const host = createHostCredentials(ctx, { routes })
  assert.equal(await host.find({ provider: 'opencode', pattern: OPENCODE }), 'sk-record')
})

test('lookup stays quiet without a credential service', async () => {
  assert.equal(await createHostCredentials({}, { routes }).find({ provider: 'opencode', pattern: OPENCODE }), null)
  assert.equal(await createHostCredentials({ get() { throw new Error('no service') } }).find({ provider: 'opencode', pattern: OPENCODE }), null)
  assert.equal(await createHostCredentials(hostContext(), { routes: () => { throw new Error('no llm') } }).find({ provider: 'opencode', pattern: OPENCODE }), null)
})

test('lookup never surfaces a thrown read', async () => {
  const ctx = {
    get: () => ({
      resolve: async () => { throw new Error('locked') },
      listRecords: async () => [{ key: 'llm-pi-ai/opencode-go', kind: 'api-key' }],
      readRecord: async () => { throw new Error('locked') },
    }),
  }
  assert.equal(await createHostCredentials(ctx, { routes }).find({ provider: 'opencode', pattern: OPENCODE }), null)
})
