import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createHostCredentials,
  hostCredentialKey,
  pickHostRecordKey,
  rankReferenceNames,
  referenceCandidates,
  referenceForRoute,
  scoreReference,
  secretFromRecord,
  storedReferenceNames,
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

test('a stored name claims a provider only through the provider words in it', () => {
  const opencode = { provider: 'opencode', routes: ['opencode-go'] }
  assert.ok(scoreReference('OPENCODE_GO_API_KEY', opencode) > scoreReference('OPENCODE_API_KEY', opencode))
  assert.ok(scoreReference('OPENCODE_ZEN_API_KEY', opencode) > 0)
  assert.equal(scoreReference('DEEPSEEK_API_KEY', opencode), 0)
  assert.equal(scoreReference('GOOGLE_GO_KEY', opencode), 0)
  assert.equal(scoreReference('', opencode), 0)
  assert.ok(scoreReference('ZHIPUAI_API_KEY', { provider: 'glm', routes: ['glm-4.6'] }) > 0)
})

test('ranking keeps only claiming names, the most specific first', () => {
  const stored = [
    'DEEPSEEK_API_KEY',
    'STRATA_API_KEY',
    'OPENCODE_ZEN_API_KEY',
    'OPENCODE_GO_API_KEY',
    'AGENTSPACE_API_KEY',
  ]
  assert.deepEqual(rankReferenceNames(stored, { provider: 'opencode', routes: ['opencode-go'] }), [
    'OPENCODE_GO_API_KEY',
    'OPENCODE_ZEN_API_KEY',
  ])
  assert.deepEqual(rankReferenceNames(['GLM_KEY', 'OPENCODE_API_KEY'], { provider: 'glm', routes: [] }), ['GLM_KEY'])
  assert.deepEqual(rankReferenceNames(null), [])
})

test('stored names are read from the provider snapshot', () => {
  const store = new Map([
    ['OPENCODE_GO_API_KEY', 'sk-a'],
    ['OPENCODE_OAUTH_TOKEN', 'grant-ish'],
    ['not a reference', 'sk-b'],
    ['0BAD', 'sk-c'],
  ])
  assert.deepEqual(storedReferenceNames({ values: store }), ['OPENCODE_GO_API_KEY'])
  assert.deepEqual(storedReferenceNames({ values: {} }), [])
  assert.deepEqual(storedReferenceNames({ values: { keys: () => { throw new Error('wrapped') } } }), [])
  assert.deepEqual(storedReferenceNames(null), [])
})

test('a stored spelling the route id does not derive is still found', async () => {
  const store = new Map([['MY_OPENCODE_KEY', 'sk-renamed']])
  const ctx = hostContext({ refs: { MY_OPENCODE_KEY: 'sk-renamed' }, store })
  const host = createHostCredentials(ctx, { routes })
  assert.equal(await host.find({ provider: 'opencode', pattern: OPENCODE }), 'sk-renamed')
})

test('the derived reference still wins over a stored near neighbour', async () => {
  const store = new Map([
    ['OPENCODE_GO_API_KEY', 'sk-route'],
    ['OPENCODE_ZEN_API_KEY', 'sk-zen'],
  ])
  const ctx = hostContext({ refs: { OPENCODE_GO_API_KEY: 'sk-route', OPENCODE_ZEN_API_KEY: 'sk-zen' }, store })
  const host = createHostCredentials(ctx, { routes })
  assert.equal(await host.find({ provider: 'opencode', pattern: OPENCODE }), 'sk-route')
})

function hostContext({ refs = {}, entries = [], records = {}, store } = {}) {
  return {
    get(name) {
      if (name !== 'credentials') return undefined
      return {
        ...(store ? { values: store } : {}),
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
