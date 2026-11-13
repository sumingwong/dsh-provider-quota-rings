import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// ---- a very small React stand-in: hooks, one component, re-render on state ----
function createReact() {
  const hooks = []
  let cursor = 0
  let component = null
  let props = {}
  let tree = null
  let rendering = false

  const same = (left, right) => {
    if (left === right) return true
    if (!left || !right || left.length !== right.length) return false
    return left.every((item, index) => Object.is(item, right[index]))
  }

  function render() {
    cursor = 0
    rendering = true
    const effects = []
    const original = react.useEffect
    react.useEffect = (fn, deps) => {
      const index = cursor
      cursor += 1
      const previous = hooks[index]
      if (!previous || !same(previous.deps, deps)) effects.push({ index, fn, deps })
    }
    tree = component(props)
    react.useEffect = original
    rendering = false
    for (const effect of effects) {
      const previous = hooks[effect.index]
      if (typeof previous?.cleanup === 'function') previous.cleanup()
      const cleanup = effect.fn()
      hooks[effect.index] = { deps: effect.deps, cleanup: typeof cleanup === 'function' ? cleanup : null }
    }
  }

  function schedule() {
    if (rendering) return
    queueMicrotask(render)
  }

  const react = {
    createElement(type, nextProps, ...children) {
      return { type, props: nextProps ?? {}, children: children.flat().filter((child) => child != null) }
    },
    useState(initial) {
      const index = cursor
      cursor += 1
      if (!Object.hasOwn(hooks, index)) hooks[index] = { state: initial }
      const hook = hooks[index]
      return [hook.state, (value) => {
        const next = typeof value === 'function' ? value(hook.state) : value
        if (Object.is(next, hook.state)) return
        hook.state = next
        schedule()
      }]
    },
    useRef(initial) {
      const index = cursor
      cursor += 1
      if (!hooks[index]) hooks[index] = { current: initial }
      return hooks[index]
    },
    useEffect(fn, deps) {
      const index = cursor
      cursor += 1
      if (!hooks[index]) hooks[index] = { deps, cleanup: null, fn }
    },
    mount(next, nextProps = {}) {
      component = next
      props = nextProps
      render()
      return tree
    },
    unmount() {
      for (const hook of hooks) {
        if (typeof hook?.cleanup === 'function') hook.cleanup()
      }
    },
    get tree() { return tree },
  }
  return react
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

function findAll(node, predicate) {
  const found = []
  walk(node, (item) => { if (predicate(item)) found.push(item) })
  return found
}

// Pure presentational children (rings, brand marks) take no hooks, so the test
// can expand them by hand and assert on the real SVG attributes.
function materialize(node) {
  if (Array.isArray(node)) return node.map(materialize)
  if (!node || typeof node !== 'object') return node
  if (typeof node.type === 'function') return materialize(node.type(node.props))
  return { ...node, children: (node.children ?? []).map(materialize) }
}

function loadFactory(innerWidth = 390) {
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  let loaded = null
  const timers = []
  const context = vm.createContext({
    window: { __ModuleLoader__: { load(registration) { loaded = registration } }, innerWidth },
    setInterval(fn, ms) { timers.push({ fn, ms, cleared: false }); return timers.length },
    clearInterval(id) { const timer = timers[id - 1]; if (timer) timer.cleared = true },
    setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String, Number, Error,
    AbortController, Set, Map, Promise, Symbol, RegExp, Boolean, parseInt, isFinite, encodeURIComponent,
  })
  vm.runInContext(source, context, { filename: 'client.js' })
  return { factory: loaded.factory, timers }
}

function ring(fraction, caption) {
  return { fraction, caption, title: caption }
}

function snapshot(rows, extra = {}) {
  return {
    exampleData: false,
    detected: { routes: ['opencode-go', 'openai-codex', 'strata'], providers: rows.map((row) => row.id) },
    visible: rows.map((row) => row.id),
    liveReads: true,
    glmPlatform: 'zhipu',
    generatedAt: 1_700_000_000_000,
    rows,
    ...extra,
  }
}

function ok(value) {
  return { ok: true, value }
}

async function flush() {
  for (let index = 0; index < 12; index += 1) await new Promise((resolve) => setImmediate(resolve))
}

function mountClient({ read, locale = 'zh' }) {
  const react = createReact()
  const { factory, timers } = loadFactory()
  const registrations = new Map()
  const injected = []
  const actions = []
  let contribution = null
  let releases = 0
  const ctx = {
    get(name) {
      if (name === 'locale') return { register(namespace, packs) { ctx.registered = { namespace, packs } }, getLocale: () => ({ id: locale }) }
      if (name === 'remote.quotaRings') return ctx.remote.quotaRings ?? null
      return null
    },
    remote: {
      async $mount(next) {
        contribution = next
        for (const descriptor of next.descriptors) {
          if (descriptor.invocation.kind !== 'direct') throw new Error('session bound')
          if (descriptor.result.mode !== 'strict') throw new Error('missing strict codec')
          descriptor.result.create()
        }
        ctx.remote.quotaRings = {
          read(signal) { return read(signal, { method: 'read' }) },
          refresh(providerId, signal) { actions.push({ method: 'refresh', providerId }); return read(signal, { method: 'refresh', providerId }) },
          setDisabled(providerId, disabled, signal) { actions.push({ method: 'setDisabled', providerId, disabled }); return read(signal, { method: 'setDisabled', providerId, disabled }) },
          setPlatform(platform, signal) { actions.push({ method: 'setPlatform', platform }); return read(signal, { method: 'setPlatform', platform }) },
          setLiveReads(enabled, signal) { actions.push({ method: 'setLiveReads', enabled }); return read(signal, { method: 'setLiveReads', enabled }) },
          storeGlmKey(secret, signal) { actions.push({ method: 'storeGlmKey', secret }); return read(signal, { method: 'storeGlmKey', secret }) },
          storeOpenCodeKey(secret, signal) { actions.push({ method: 'storeOpenCodeKey', secret }); return read(signal, { method: 'storeOpenCodeKey', secret }) },
        }
        return async () => { releases += 1; ctx.remote.quotaRings = null }
      },
    },
    slots: {
      inject(name, callback) { injected.push(name); callback() },
      register(meta, component) { registrations.set(meta.name, { meta, component }); return () => {} },
    },
    effect(callback) { ctx.stop = callback() },
  }
  factory((id) => {
    if (id === 'react') return react
    throw new Error(`unexpected require ${id}`)
  }).apply(ctx)
  return {
    react,
    ctx,
    injected,
    actions,
    timers,
    contribution: () => contribution,
    releases: () => releases,
    component: (name) => registrations.get(name)?.component,
    meta: (name) => registrations.get(name)?.meta,
    mount(slot = 'sidebar.footer.action', props = { wide: true }) {
      return materialize(react.mount(this.component(slot), props))
    },
    tree() { return materialize(react.tree) },
  }
}

test('registers the footer, one settings page and its icon', () => {
  const seen = mountClient({ read: () => Promise.resolve(ok(snapshot([]))) })
  seen.mount()
  assert.deepEqual(seen.injected, ['sidebar.footer.action', 'settings.section', 'settings.section.icon'])
  assert.equal(seen.meta('sidebar.footer.action').id, 'provider-quota-rings')
  assert.equal(seen.meta('sidebar.footer.action').order, 40)
  assert.equal(seen.meta('settings.section').id, 'provider-quota-rings')
  assert.equal(seen.meta('settings.section').order, 60)
  assert.equal(seen.meta('settings.section').label(), '额度圆环')
  assert.equal(seen.meta('settings.section.icon').id, 'provider-quota-rings')
  assert.equal(seen.contribution().package, 'dsh-provider-quota-rings')
})

test('the footer draws the short period inside and the long one outside', async () => {
  const seen = mountClient({
    read: () => Promise.resolve(ok(snapshot([
      { id: 'codex', label: 'Codex', status: 'fresh', statusText: '额度可读。', rings: [ring(0.99, '5小时'), ring(0.7, '1周')], windows: [] },
      { id: 'opencode', label: 'OpenCode Go', status: 'unknown', statusText: '未知', rings: [ring(null, '未知')], windows: [] },
    ]))),
  })
  seen.mount()
  await flush()
  const tree = seen.tree()
  const root = findAll(tree, (node) => node.props?.['data-quota-rings'] === 'footer')[0]
  assert.equal(root.props['data-provider-count'], '2')
  const codex = findAll(tree, (node) => node.props?.['data-provider-ring'] === 'codex')[0]
  assert.equal(codex.props['data-inner'], '99')
  assert.equal(codex.props['data-outer'], '70')
  assert.match(codex.props['aria-label'], /5小时 99%/)
  assert.match(codex.props['aria-label'], /1周 70%/)
  const legend = findAll(tree, (node) => node.props?.['data-percent'] === '99% · 70%')
  assert.equal(legend.length, 1)
  // an unknown period keeps the dashed tray and draws no arc
  const opencode = findAll(tree, (node) => node.props?.['data-provider-ring'] === 'opencode')[0]
  assert.equal(opencode.props['data-inner'], 'unknown')
  assert.equal(opencode.props['data-outer'], 'unknown')
  assert.equal(findAll(opencode, (node) => node.props?.strokeDasharray === '2 3').length, 2)
})

test('a lone period stays on the outer ring', async () => {
  const seen = mountClient({
    read: () => Promise.resolve(ok(snapshot([
      { id: 'glm', label: 'GLM', status: 'fresh', statusText: '额度可读。', rings: [ring(0.5, '1周')], windows: [] },
    ]))),
  })
  seen.mount()
  await flush()
  const glm = findAll(seen.tree(), (node) => node.props?.['data-provider-ring'] === 'glm')[0]
  assert.equal(glm.props['data-inner'], 'unknown')
  assert.equal(glm.props['data-outer'], '50')
})

test('only the rows the host detected reach the footer', async () => {
  const seen = mountClient({
    read: () => Promise.resolve(ok(snapshot([
      { id: 'codex', label: 'Codex', status: 'fresh', statusText: '额度可读。', rings: [ring(0.9, '1周')], windows: [] },
      { id: 'opencode', label: 'OpenCode Go', status: 'unknown', statusText: '未知', rings: [ring(null, '未知')], windows: [] },
    ]))),
  })
  seen.mount()
  await flush()
  const ids = findAll(seen.tree(), (node) => node.props?.['data-provider-row']).map((node) => node.props['data-provider-row'])
  assert.deepEqual(ids, ['codex', 'opencode'])
  assert.equal(JSON.stringify(seen.tree()).includes('Claude'), false)
})

test('mounts the remote, reads once and schedules a five-minute silent sync', async () => {
  const seen = mountClient({ read: () => Promise.resolve(ok(snapshot([]))) })
  const tree = seen.mount()
  await flush()
  assert.equal(seen.timers.length, 1)
  assert.equal(seen.timers[0].ms, 300000)
  const notice = findAll(seen.tree(), (node) => node.props?.['data-notice'] === '1')
  assert.equal(notice.length, 1)
  assert.match(JSON.stringify(notice[0].children), /已读取/)
  seen.react.unmount()
  assert.equal(seen.timers[0].cleared, true)
  assert.equal(seen.releases() >= 0, true)
  assert.ok(tree)
})

test('an unreadable snapshot reports instead of painting numbers', async () => {
  const seen = mountClient({ read: () => Promise.resolve({ ok: true, value: { nope: true } }) })
  seen.mount()
  await flush()
  const notice = findAll(seen.tree(), (node) => node.props?.['data-notice'] === '1')
  assert.match(JSON.stringify(notice[0].children), /无法解析/)
  assert.equal(findAll(seen.tree(), (node) => node.props?.['data-provider-ring']).length, 0)
})

test('the settings page lists the detected routes and each visible provider', async () => {
  const seen = mountClient({
    read: () => Promise.resolve(ok(snapshot([
      { id: 'codex', label: 'Codex', status: 'fresh', statusText: '额度可读。', rings: [ring(0.9, '1周')], windows: [] },
    ]))),
  })
  seen.mount('settings.section', { close() {} })
  await flush()
  const text = JSON.stringify(seen.tree())
  assert.match(text, /opencode-go/)
  assert.match(text, /openai-codex/)
  assert.match(text, /额度可读。/)
  assert.equal(findAll(seen.tree(), (node) => node.props?.['data-quota-section'] === 'live').length, 1)
  assert.equal(findAll(seen.tree(), (node) => node.props?.['data-quota-section'] === 'keys').length, 1)
})

test('a stored key is never echoed back into the footer', async () => {
  const seen = mountClient({
    read(_signal, action) {
      if (action.method === 'storeOpenCodeKey') {
        return Promise.resolve(ok({ ok: true, message: `saved ${action.secret}` }))
      }
      return Promise.resolve(ok(snapshot([
        { id: 'opencode', label: 'OpenCode Go', status: 'unknown', statusText: '未知', rings: [ring(null, '未知')], windows: [] },
      ])))
    },
  })
  seen.mount()
  await flush()
  const form = findAll(seen.tree(), (node) => node.type === 'form' && node.props?.key === 'opencode')[0]
  const input = findAll(form, (node) => node.type === 'input')[0]
  input.props.onChange({ target: { value: 'fixture-opencode-token' } })
  await flush()
  const nextForm = findAll(seen.tree(), (node) => node.type === 'form' && node.props?.key === 'opencode')[0]
  nextForm.props.onSubmit({ preventDefault() {} })
  await flush()
  assert.equal(seen.actions.some((item) => item.method === 'storeOpenCodeKey' && item.secret === 'fixture-opencode-token'), true)
  assert.equal(JSON.stringify(seen.tree()).includes('fixture-opencode-token'), false)
})
