import assert from 'node:assert/strict'
import test from 'node:test'
import { durationCaption, remainingFraction, selectRings } from '../src/model.js'
import { quantityText, remainingText, resetDistanceText, resetText, scopeText, toDisplay } from '../src/display.js'
import { redactText } from '../src/redact.js'

const hour = 60 * 60 * 1000

test('missing totals stay unknown instead of 0 or 100', () => {
  assert.equal(remainingFraction({ scope: 'model' }), null)
  assert.equal(remainingFraction({ usedRatio: Number.NaN }), null)
  assert.equal(remainingText({ scope: 'model' }), '未知')
  assert.equal(quantityText({ scope: 'model' }), '未知')
  assert.equal(remainingFraction({ usedRatio: 0.25 }), 0.75)
  assert.equal(remainingFraction({ remainingRatio: 0.5, usedRatio: 0.1 }), 0.5)
  assert.equal(remainingFraction({ remaining: 30, limit: 40 }), 0.75)
})

test('credit windows show neutral raw fields and stay out of the rings', () => {
  const credit = {
    label: '积分额度 2（周期未知）',
    scope: 'credit',
    durationMs: null,
    usedRatio: 0.02,
    credit: { currentValue: 280, usage: 10000, remaining: 9719 },
  }
  assert.equal(scopeText('credit'), '积分（周期未知）')
  assert.equal(quantityText(credit), 'currentValue 280，usage 10000，remaining 9719')
  assert.equal(remainingFraction(credit), 0.98)
  assert.deepEqual(selectRings([credit]), [])
  assert.equal(quantityText({ scope: 'credit', credit: { currentValue: 3 } }), 'currentValue 3')
  assert.equal(quantityText({ scope: 'credit', credit: { remaining: 4 } }), 'remaining 4')
  assert.equal(quantityText({ scope: 'credit' }), '未知')
  const display = toDisplay({
    glmPlatform: 'zhipu',
    byId: {
      glm: { status: 'fresh', windows: [credit] },
    },
  })
  const row = display.rows.find((item) => item.id === 'glm')
  assert.equal(row.windows[0].scopeText, '积分（周期未知）')
  assert.equal(row.windows[0].quantityLabel, '积分字段')
  assert.equal(row.windows[0].quantityText, 'currentValue 280，usage 10000，remaining 9719')
  assert.deepEqual(row.windows[0].credit, { currentValue: 280, usage: 10000, remaining: 9719 })
  assert.equal(row.rings[0].fraction, null)
})

test('bad reset timestamps stay unknown without breaking other rows', () => {
  const windows = [
    { label: '坏日期', scope: 'model', durationMs: hour, usedRatio: 0.2, resetsAt: 8_640_000_000_000_001 },
    { label: '超大日期', scope: 'model', durationMs: hour, usedRatio: 0.3, resetsAt: 1e308 },
    { label: '正常日期', scope: 'model', durationMs: hour, usedRatio: 0.4, resetsAt: 1_794_541_841_984 },
  ]
  assert.equal(resetText(windows[0]), '未知')
  assert.equal(resetText(windows[1]), '未知')
  assert.equal(resetText(windows[2]), '2026-11-13T03:50:41.984Z')
  assert.equal(resetDistanceText(windows[0]), '未知')
  assert.equal(resetDistanceText(windows[1]), '未知')
  const display = toDisplay({
    glmPlatform: 'zhipu',
    byId: {
      glm: { status: 'fresh', windows },
      codex: { status: 'fresh', windows: [{ label: '正常', scope: 'model', durationMs: hour, usedRatio: 0.1 }] },
    },
  })
  assert.equal(display.rows.find((row) => row.id === 'glm').windows[0].resetText, '未知')
  assert.equal(display.rows.find((row) => row.id === 'codex').windows.length, 1)
})

test('rings use the shortest and longest model windows only', () => {
  const windows = [
    { label: '5小时', scope: 'model', durationMs: 5 * hour, usedRatio: 0.2 },
    { label: '一天', scope: 'model', durationMs: 24 * hour, usedRatio: 0.4 },
    { label: '一周', scope: 'model', durationMs: 7 * 24 * hour, usedRatio: 0.6 },
    { label: 'MCP', scope: 'tool', durationMs: 30 * 24 * hour, usedRatio: 0.1 },
    { label: '缺时长', scope: 'model', durationMs: null, usedRatio: 0.1 },
    { label: '缺数量', scope: 'model', durationMs: 3 * hour, usedRatio: null },
    { label: '未知范围', scope: 'unknown', durationMs: hour, usedRatio: 0.1 },
  ]
  const rings = selectRings(windows)
  assert.deepEqual(rings.map((ring) => ring.caption), ['5小时', '1周'])
  assert.equal(rings[0].fraction, 0.8)
  assert.equal(selectRings([windows[0]]).length, 1)
  assert.equal(selectRings([
    { scope: 'model', durationMs: 5 * hour, usedRatio: 0.2, label: 'a' },
    { scope: 'model', durationMs: 5 * hour, usedRatio: 0.3, label: 'b' },
  ]).length, 1)
  assert.equal(selectRings([windows[3]]).length, 0)
  assert.equal(durationCaption(7 * 24 * hour), '1周')
})

test('display keeps five rows and does not present unknown as a percent', () => {
  const display = toDisplay({
    exampleData: false,
    glmPlatform: 'zhipu',
    liveReads: false,
    byId: {
      codex: { status: 'unknown', windows: [], experimental: false },
      claude: { status: 'unknown', windows: [], experimental: true, error: '没有接口' },
      opencode: { status: 'unknown', windows: [], experimental: true },
      grok: { status: 'unread', windows: [], link: { href: 'https://grok.com', label: 'Grok 官网' }, message: '暂无法读取' },
      glm: { status: 'unknown', windows: [], error: '未配置 GLM 密钥。' },
    },
  })
  assert.equal(display.exampleData, false)
  assert.deepEqual(display.rows.map((row) => row.id), ['codex', 'claude', 'opencode', 'grok', 'glm'])
  assert.equal(display.rows[0].rings[0].fraction, null)
  assert.equal(display.rows[3].statusText, '暂无法读取')
  const text = JSON.stringify(display)
  assert.equal(text.includes('0%'), false)
  assert.equal(text.includes('100%'), false)
  assert.equal(display.rows[3].link.href, 'https://grok.com')
  const blocked = toDisplay({
    glmPlatform: 'zhipu',
    liveReads: false,
    byId: {
      grok: { status: 'unread', windows: [], link: { href: 'javascript:alert(1)', label: 'x' } },
    },
  })
  assert.equal(blocked.rows.find((row) => row.id === 'grok').link, null)
  const http = toDisplay({
    glmPlatform: 'zhipu',
    liveReads: false,
    byId: {
      grok: { status: 'unread', windows: [], link: { href: 'http://grok.com', label: 'x' } },
    },
  })
  assert.equal(http.rows.find((row) => row.id === 'grok').link, null)
})

test('redact hides assignments, url userinfo, and short password flags', () => {
  const text = redactText('Authorization: abcdefgh --password hunter2 postgres://user:pw@localhost -pS3cret', ['abcdefgh'])
  assert.equal(text.includes('abcdefgh'), false)
  assert.equal(text.includes('hunter2'), false)
  assert.equal(text.includes('user:pw'), false)
  assert.equal(text.includes('S3cret'), false)
  const spaced = redactText('tool -p hunter22 says Bearer sk-fixture-token', [])
  assert.equal(spaced.includes('hunter22'), false)
  assert.equal(spaced.includes('sk-fixture-token'), false)
})
