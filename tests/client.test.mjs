import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function createReact() {
  const hooks = []
  let cursor = 0
  let component = null
  let props = {}
  let tree = null
  let rendering = false
  const cleanups = []

  function same(left, right) {
    if (left === right) return true
    if (!left || !right || left.length !== right.length) return false
    return left.every((item, index) => Object.is(item, right[index]))
  }

  function render() {
    cursor = 0
    rendering = true
    const effects = []
    const previousUseEffect = react.useEffect
    react.useEffect = (fn, deps) => {
      const index = cursor
      cursor += 1
      const prev = hooks[index]
      if (!prev || !same(prev.deps, deps)) effects.push({ index, fn, deps })
    }
    tree = component(props)
    rendering = false
    react.useEffect = previousUseEffect
    for (const effect of effects) {
      const prev = hooks[effect.index]
      if (typeof prev?.cleanup === 'function') prev.cleanup()
      const cleanup = effect.fn()
      hooks[effect.index] = {
        deps: effect.deps,
        cleanup: typeof cleanup === 'function' ? cleanup : null,
      }
      if (typeof hooks[effect.index].cleanup === 'function') cleanups.push(hooks[effect.index].cleanup)
    }
  }

  function schedule() {
    if (rendering) return
    queueMicrotask(render)
  }

  const react = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat().filter((child) => child != null) }
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
    useCallback(fn, deps) {
      const index = cursor
      cursor += 1
      const prev = hooks[index]
      if (!prev || !same(prev.deps, deps)) hooks[index] = { fn, deps }
      return hooks[index].fn
    },
    useEffect(fn, deps) {
      const index = cursor
      cursor += 1
      if (!hooks[index]) hooks[index] = { deps, cleanup: null, fn }
      void fn
      void deps
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

function findAll(node, pred) {
  const found = []
  walk(node, (item) => { if (pred(item)) found.push(item) })
  return found
}

function model(mark, extra = {}) {
  const codex = {
    id: 'codex',
    label: 'Codex',
    status: 'fresh',
    statusText: mark,
    updatedAt: 1_700_000_000_000,
    source: 'codex account/rateLimits/read',
    rings: [
      { fraction: 0.75, caption: '5小时', title: '5小时' },
      { fraction: 0.5, caption: '1周', title: '1周' },
    ],
    windows: [],
    ...extra.codex,
  }
  return {
    exampleData: false,
    liveReads: false,
    glmKeyStored: false,
    opencodeKeyStored: false,
    rows: [
      codex,
      { id: 'claude', label: 'Claude', status: 'unknown', statusText: '未知', rings: [{ fraction: null, caption: '未知' }], windows: [] },
      { id: 'opencode', label: 'OpenCode Go', status: 'unknown', statusText: '未知', rings: [{ fraction: null, caption: '未知' }], windows: [] },
      { id: 'grok', label: 'Grok', status: 'unread', statusText: '暂无法读取', rings: [{ fraction: null, caption: '未知' }], windows: [], link: { href: 'https://grok.com', label: 'Grok 官网' } },
      { id: 'glm', label: 'GLM', status: 'unknown', statusText: '未知', rings: [{ fraction: null, caption: '未知' }], windows: [] },
    ],
  }
}

function ok(value) {
  return { ok: true, value }
}

async function flush() {
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setImmediate(resolve))
}

function contains(box, x, y) {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
}

function loadFactory(innerWidth = 390) {
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  let loaded = null
  const timers = []
  const context = vm.createContext({
    window: { __ModuleLoader__: { load(mod) { loaded = mod } }, innerWidth },
    setInterval(fn, ms) {
      const id = timers.length + 1
      timers.push({ id, fn, ms, cleared: false })
      return id
    },
    clearInterval(id) {
      const timer = timers.find((item) => item.id === id)
      if (timer) timer.cleared = true
    },
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Error,
    AbortController,
    Set,
    Map,
    Promise,
    Symbol,
    RegExp,
    Boolean,
    parseInt,
    isFinite,
  })
  vm.runInContext(source, context, { filename: 'client.js' })
  return {
    timers,
    factory: loaded.factory,
  }
}

function mountClient({ read, locale = 'zh', mount = true, innerWidth = 390 }) {
  const react = createReact()
  const { factory, timers } = loadFactory(innerWidth)
  const commands = []
  const reads = []
  const actions = []
  let disposed = false
  let Footer = null
  let contribution = null
  const ctx = {
    locale: {
      register(namespace, packs) { ctx.registered = { namespace, packs } },
      getLocale() { return { id: locale } },
    },
    remote: {
      commands: {
        execute(...args) {
          commands.push(args)
          throw new Error('commands.execute')
        },
      },
      async $mount(next) {
        if (!mount) throw new Error('mount refused')
        contribution = next
        for (const descriptor of next.descriptors) {
          if (descriptor.invocation.kind !== 'direct') throw new Error('session bound')
          if (descriptor.result.mode !== 'strict' || typeof descriptor.result.create !== 'function') {
            throw new Error('missing strict codec')
          }
          descriptor.result.create()
        }
        const api = {
          read(signal) {
            reads.push({ signal, session: null })
            return read(signal, { method: 'read' })
          },
          refresh(providerId, signal) {
            actions.push({ method: 'refresh', providerId, signal })
            return read(signal, { method: 'refresh', providerId })
          },
          setDisabled(providerId, disabled, signal) {
            actions.push({ method: 'setDisabled', providerId, disabled, signal })
            return read(signal, { method: 'setDisabled', providerId, disabled })
          },
          setPlatform(platform, signal) {
            actions.push({ method: 'setPlatform', platform, signal })
            return read(signal, { method: 'setPlatform', platform })
          },
          storeGlmKey(secret, signal) {
            actions.push({ method: 'storeGlmKey', secret, signal })
            return read(signal, { method: 'storeGlmKey', secret })
          },
          storeOpenCodeKey(secret, signal) {
            actions.push({ method: 'storeOpenCodeKey', secret, signal })
            return read(signal, { method: 'storeOpenCodeKey', secret })
          },
        }
        ctx.remote.quotaRings = api
        return async () => { disposed = true; ctx.remote.quotaRings = null }
      },
    },
    slots: {
      inject(name, callback) {
        assert.equal(name, 'sidebar.footer.action')
        callback()
      },
      register(_meta, component) { Footer = component },
    },
    effect(callback) { ctx.stop = callback() },
  }
  factory((id) => {
    if (id === 'react') return react
    throw new Error(`unexpected require ${id}`)
  }).apply(ctx)
  const tree = react.mount(Footer, { wide: true })
  return {
    react,
    ctx,
    commands,
    reads,
    actions,
    contribution: () => contribution,
    disposed: () => disposed,
    tree: () => react.tree ?? tree,
    timers,
  }
}

test('the mounted client reads through the remote with no session and schedules a silent sync', async () => {
  const seen = mountClient({
    read() { return Promise.resolve(ok(model('已更新'))) },
  })
  await flush()
  const tree = seen.tree()
  const notice = findAll(tree, (node) => node.props?.['data-notice'] === '1')
  assert.equal(notice.length, 1)
  assert.match(JSON.stringify(notice[0].children), /已读取/)
  assert.equal(seen.commands.length, 0)
  assert.equal(seen.reads.length, 1)
  assert.equal(seen.reads[0].session, null)
  assert.equal(seen.contribution().descriptors.find((item) => item.method === 'read').invocation.kind, 'direct')
  assert.equal(seen.contribution().descriptors.find((item) => item.method === 'read').parameters.length, 0)
  assert.equal(seen.timers.length, 1)
  assert.equal(seen.timers[0].ms, 300000)
  const button = findAll(tree, (node) => node.props?.['data-provider'] === 'codex')[0]
  assert.equal(button.props.title, undefined)
  const labels = findAll(button, (node) => node.props?.['aria-label']).map((node) => node.props['aria-label'])
  assert.equal(labels.some((text) => /5小时/.test(text) && /75%/.test(text)), true)
  assert.equal(labels.some((text) => /1周/.test(text)), true)
  button.props.onClick()
  await flush()
  const source = findAll(seen.tree(), (node) => node.props?.['data-source'] === '1')
  assert.equal(source.length, 1)
  assert.match(JSON.stringify(source[0].children), /codex account\/rateLimits\/read/)
  assert.equal(seen.commands.length, 0)
  seen.react.unmount()
  assert.equal(seen.timers[0].cleared, true)
})

test('an older read cannot overwrite a newer one, and a bad snapshot stays visible', async () => {
  const first = deferred()
  const second = deferred()
  const third = deferred()
  const seen = mountClient({
    read(_signal, action) {
      if (action.method === 'read' && seen.reads.length === 1) return first.promise
      if (action.method === 'refresh' && seen.actions.filter((item) => item.method === 'refresh').length === 1) return second.promise
      return third.promise
    },
  })
  await flush()
  first.resolve(ok(model('第一轮')))
  await flush()
  findAll(seen.tree(), (node) => node.props?.['data-provider'] === 'codex')[0].props.onClick()
  await flush()
  const refresh = () => findAll(seen.tree(), (node) => node.props?.['data-action'] === 'refresh')[0]
  refresh().props.onClick()
  await flush()
  refresh().props.onClick()
  await flush()
  third.resolve(ok(model('第三轮')))
  await flush()
  assert.match(JSON.stringify(seen.tree()), /第三轮/)
  second.resolve(ok(model('第二轮不能覆盖')))
  await flush()
  const text = JSON.stringify(seen.tree())
  assert.match(text, /第三轮/)
  assert.equal(text.includes('第二轮不能覆盖'), false)
  assert.equal(seen.commands.length, 0)
  const late = deferred()
  const broken = mountClient({
    read() { return late.promise },
  })
  late.resolve(ok({ rows: 'bad' }))
  await flush()
  assert.match(JSON.stringify(broken.tree()), /额度结果无法解析/)
  assert.equal(findAll(broken.tree(), (node) => node.props?.['data-notice'] === '1').length, 1)
  seen.react.unmount()
  broken.react.unmount()
})

test('a read with no session does not use the command, and unmount aborts it', async () => {
  const seen = mountClient({
    read() { return Promise.resolve(ok(model('无会话'))) },
  })
  await flush()
  assert.equal(seen.commands.length, 0)
  assert.equal(seen.reads.length, 1)
  assert.equal(seen.reads[0].session, null)
  findAll(seen.tree(), (node) => node.props?.['data-provider'] === 'codex')[0].props.onClick()
  await flush()
  assert.match(JSON.stringify(seen.tree()), /无会话/)
  assert.equal(JSON.stringify(seen.tree()).includes('当前没有会话'), false)
  assert.equal(findAll(seen.tree(), (node) => node.props?.['data-provider']).map((node) => node.props['data-provider']).join(','), 'codex,claude,opencode,grok,glm')

  let signal
  const hung = deferred()
  const reading = mountClient({
    read(next) {
      signal = next
      return hung.promise
    },
  })
  await flush()
  assert.equal(signal.aborted, false)
  reading.react.unmount()
  assert.equal(signal.aborted, true)
  hung.resolve(ok(model('卸载后')))
  await flush()
  assert.equal(JSON.stringify(reading.tree()).includes('卸载后'), false)
  reading.ctx.stop?.()
  assert.equal(reading.disposed(), true)
})

test('disabled rings lose their fraction, english locale switches, and store does not use the command', async () => {
  const seen = mountClient({
    locale: 'en-US',
    read(_signal, action) {
      if (action.method === 'storeGlmKey') {
        assert.equal(JSON.stringify(action).includes('commands.execute'), false)
        return Promise.resolve(ok({ ok: true, message: 'stored' }))
      }
      return Promise.resolve(ok(model('updated', {
        codex: { status: 'disabled', rings: [{ fraction: 0.8, caption: '5小时' }] },
      })))
    },
  })
  await flush()
  assert.match(JSON.stringify(seen.tree()), /Read/)
  const ring = findAll(seen.tree(), (node) => node.props?.['data-fraction'] != null && node.props?.['data-caption'] === '已停用')
  assert.equal(ring.length, 1)
  assert.equal(ring[0].props['data-fraction'], 'unknown')
  findAll(seen.tree(), (node) => node.props?.['data-provider'] === 'glm')[0].props.onClick()
  await flush()
  let reset = false
  const form = findAll(seen.tree(), (node) => node.type === 'form')[0]
  form.props.onSubmit({
    preventDefault() {},
    target: {
      elements: { glmKey: { value: 'fixture-store-token' } },
      reset() { reset = true },
    },
  })
  await flush()
  assert.equal(reset, true)
  assert.equal(seen.commands.length, 0)
  assert.equal(seen.actions.some((item) => item.method === 'storeGlmKey' && item.secret === 'fixture-store-token'), true)
  assert.equal(JSON.stringify(seen.tree()).includes('fixture-store-token'), false)
  assert.equal(seen.ctx.registered.namespace, 'dsh-provider-quota-rings')
  seen.react.unmount()
})

test('a silent five-minute read updates the client cache without a second command', async () => {
  let round = 0
  const seen = mountClient({
    read() {
      round += 1
      return Promise.resolve(ok(model(round === 1 ? '第一份缓存' : '五分钟后的缓存')))
    },
  })
  await flush()
  assert.equal(seen.reads.length, 1)
  findAll(seen.tree(), (node) => node.props?.['data-provider'] === 'codex')[0].props.onClick()
  await flush()
  assert.match(JSON.stringify(seen.tree()), /第一份缓存/)
  const noticeBefore = JSON.stringify(findAll(seen.tree(), (node) => node.props?.['data-notice'] === '1'))
  seen.timers[0].fn()
  await flush()
  assert.equal(seen.reads.length, 2)
  assert.equal(seen.commands.length, 0)
  assert.match(JSON.stringify(seen.tree()), /五分钟后的缓存/)
  assert.equal(JSON.stringify(seen.tree()).includes('第一份缓存'), false)
  assert.equal(JSON.stringify(findAll(seen.tree(), (node) => node.props?.['data-notice'] === '1')), noticeBefore)

  const hung = deferred()
  const busy = mountClient({
    read() { return hung.promise },
  })
  await flush()
  assert.equal(busy.reads.length, 1)
  busy.timers[0].fn()
  await flush()
  assert.equal(busy.reads.length, 1)
  hung.resolve(ok(model('挂起结束')))
  await flush()
  busy.react.unmount()
  assert.equal(busy.timers[0].cleared, true)
  seen.react.unmount()
})

test('hover and focus show every cached window and do not read again', async () => {
  const seen = mountClient({
    read() {
      return Promise.resolve(ok(model('数据较旧 2023-11-14T22:13:20.000Z 超时', {
        codex: {
          status: 'stale',
          windows: [
            { label: '短', scope: 'model', scopeText: '模型', fraction: 0.62, remainingText: '62%', resetDistanceText: '3小时5分', showQuantity: false, quantityText: '未知' },
            { label: '长', scope: 'model', scopeText: '模型', fraction: 0.41, remainingText: '41%', resetDistanceText: '未知', showQuantity: false, quantityText: '未知' },
            { label: 'MCP', scope: 'tool', scopeText: '工具（月额度）', fraction: null, remainingText: '未知', resetDistanceText: '未知', showQuantity: true, quantityText: '3/10' },
          ],
        },
      })))
    },
  })
  await flush()
  assert.equal(findAll(seen.tree(), (node) => node.props?.['data-hover-card']).length, 0)
  const codexButton = findAll(seen.tree(), (node) => node.props?.['data-provider'] === 'codex')[0]
  const rings = findAll(codexButton, (node) => node.props?.['data-fraction'] != null && node.type === 'svg')
  assert.equal(rings.length, 2)
  const wrap = findAll(seen.tree(), (node) => node.props?.onMouseEnter && findAll(node, (child) => child.props?.['data-provider'] === 'codex').length > 0)[0]
  const before = seen.reads.length
  const wrapperRect = { left: 12, top: 40, right: 52, bottom: 80, width: 40, height: 40 }
  wrap.props.onMouseEnter({ currentTarget: { getBoundingClientRect: () => wrapperRect } })
  await flush()
  const card = findAll(seen.tree(), (node) => node.props?.['data-hover-card'] === 'codex')
  assert.equal(card.length, 1)
  assert.equal(card[0].props['data-card-position'], 'fixed')
  assert.equal(card[0].props['data-overlap'], '8')
  assert.equal(card[0].props.style.transform, 'translateY(-100%)')
  assert.equal(card[0].props.style.top, 48)
  assert.equal(card[0].props.tabIndex, 0)
  assert.ok(card[0].props.style.top >= wrapperRect.top)
  const hoverBridge = findAll(seen.tree(), (node) => node.props?.['data-hover-bridge'] === 'codex')
  assert.equal(hoverBridge.length, 1)
  const cardRect = {
    left: card[0].props.style.left,
    right: card[0].props.style.left + 200,
    top: card[0].props.style.top - 160,
    bottom: card[0].props.style.top,
  }
  const bridgeRect = {
    left: hoverBridge[0].props.style.left,
    right: hoverBridge[0].props.style.left + hoverBridge[0].props.style.width,
    top: hoverBridge[0].props.style.top,
    bottom: hoverBridge[0].props.style.top + hoverBridge[0].props.style.height,
  }
  const hits = (x, y) => contains(wrapperRect, x, y) || contains(cardRect, x, y) || contains(bridgeRect, x, y)
  const path = [
    { x: 30, y: 60 },
    { x: 30, y: 44 },
    { x: 30, y: 36 },
    { x: 30, y: 20 },
  ]
  for (const point of path) {
    assert.equal(hits(point.x, point.y), true, JSON.stringify(point))
    assert.equal(findAll(seen.tree(), (node) => node.props?.['data-hover-card'] === 'codex').length, 1)
  }
  assert.equal(hits(400, 60), false)
  assert.equal(findAll(seen.tree(), (node) => node.props?.['data-provider'] === 'codex')[0].props.title, undefined)
  const text = JSON.stringify(card[0])
  assert.match(text, /短/)
  assert.match(text, /长/)
  assert.match(text, /MCP/)
  assert.match(text, /62%/)
  assert.match(text, /41%/)
  assert.match(text, /3小时5分/)
  assert.match(text, /工具（月额度）/)
  assert.match(text, /3\/10/)
  assert.match(text, /数据较旧/)
  const remainings = findAll(card[0], (node) => node.props?.['data-remaining'] != null).map((node) => node.props['data-remaining'])
  assert.deepEqual(remainings, ['62%', '41%', '未知'])
  assert.equal(remainings.includes('100%'), false)
  assert.equal(remainings.includes('80%'), false)
  assert.equal(remainings.includes('14%'), false)
  const bars = findAll(card[0], (node) => node.props?.['data-remaining-bar'] != null)
  assert.deepEqual(bars.map((node) => node.props['data-remaining-bar']), ['0.62', '0.41', 'unknown'])
  assert.equal(seen.reads.length, before)
  assert.equal(seen.commands.length, 0)
  wrap.props.onMouseLeave()
  await flush()
  assert.equal(findAll(seen.tree(), (node) => node.props?.['data-hover-card']).length, 0)
  wrap.props.onFocus()
  await flush()
  const focusCard = findAll(seen.tree(), (node) => node.props?.['data-hover-card'] === 'codex')[0]
  assert.ok(focusCard)
  wrap.props.onBlur({ currentTarget: { contains: (node) => node === focusCard }, relatedTarget: focusCard })
  await flush()
  assert.equal(findAll(seen.tree(), (node) => node.props?.['data-hover-card'] === 'codex').length, 1)
  wrap.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: {} })
  await flush()
  assert.equal(findAll(seen.tree(), (node) => node.props?.['data-hover-card']).length, 0)
  const button = findAll(seen.tree(), (node) => node.props?.['data-provider'] === 'codex')[0]
  button.props.onClick()
  await flush()
  assert.equal(findAll(seen.tree(), (node) => node.props?.['data-quota-dialog'] === 'codex').length, 1)
  assert.equal(seen.reads.length, before)
  seen.react.unmount()
})

test('hover card clamps to both viewport edges in a narrow sidebar', async () => {
  const seen = mountClient({
    read() { return Promise.resolve(ok(model('窄口'))) },
    innerWidth: 320,
  })
  await flush()
  const wrap = findAll(seen.tree(), (node) => node.props?.onMouseEnter && findAll(node, (child) => child.props?.['data-provider'] === 'codex').length > 0)[0]
  wrap.props.onMouseEnter({ currentTarget: { getBoundingClientRect: () => ({ left: 300, top: 100, right: 340, bottom: 140, width: 40, height: 40 }) } })
  await flush()
  let card = findAll(seen.tree(), (node) => node.props?.['data-hover-card'] === 'codex')[0]
  assert.equal(card.props.style.left, 88)
  wrap.props.onMouseEnter({ currentTarget: { getBoundingClientRect: () => ({ left: -20, top: 100, right: 20, bottom: 140, width: 40, height: 40 }) } })
  await flush()
  card = findAll(seen.tree(), (node) => node.props?.['data-hover-card'] === 'codex')[0]
  assert.equal(card.props.style.left, 8)
  seen.react.unmount()
})

test('a silent refresh throw keeps the previous notice and model, while a manual throw still reports', async () => {
  let round = 0
  const seen = mountClient({
    read(_signal, action) {
      if (action.method === 'refresh') return Promise.reject(new Error('manual fixture failure'))
      round += 1
      if (round === 1) return Promise.resolve(ok(model('第一份缓存')))
      return Promise.resolve(ok({ rows: 'bad' }))
    },
  })
  await flush()
  const noticeBefore = JSON.stringify(findAll(seen.tree(), (node) => node.props?.['data-notice'] === '1'))
  assert.match(noticeBefore, /已读取/)
  findAll(seen.tree(), (node) => node.props?.['data-provider'] === 'codex')[0].props.onClick()
  await flush()
  seen.timers[0].fn()
  await flush()
  assert.equal(seen.reads.length, 2)
  assert.match(JSON.stringify(seen.tree()), /第一份缓存/)
  assert.equal(JSON.stringify(findAll(seen.tree(), (node) => node.props?.['data-notice'] === '1')), noticeBefore)
  findAll(seen.tree(), (node) => node.props?.['data-action'] === 'refresh')[0].props.onClick()
  await flush()
  assert.match(JSON.stringify(findAll(seen.tree(), (node) => node.props?.['data-notice'] === '1')), /额度结果无法解析/)
  assert.match(JSON.stringify(seen.tree()), /第一份缓存/)
  seen.react.unmount()
})

test('OpenCode Go stores its key through the session-free remote and never echoes it', async () => {
  const seen = mountClient({
    read(_signal, action) {
      if (action.method === 'storeOpenCodeKey') {
        return Promise.resolve(ok({ ok: true, message: 'stored in keychain' }))
      }
      return Promise.resolve(ok(model('opencode ready')))
    },
  })
  await flush()
  findAll(seen.tree(), (node) => node.props?.['data-provider'] === 'opencode')[0].props.onClick()
  await flush()
  const form = findAll(seen.tree(), (node) => node.type === 'form')[0]
  form.props.onSubmit({
    preventDefault() {},
    target: {
      elements: { opencodeKey: { value: 'fixture-opencode-store-token' } },
      reset() {},
    },
  })
  await flush()
  assert.equal(seen.actions.some((item) => item.method === 'storeOpenCodeKey' && item.secret === 'fixture-opencode-store-token'), true)
  assert.equal(seen.actions.some((item) => item.method === 'storeGlmKey'), false)
  assert.equal(JSON.stringify(seen.tree()).includes('fixture-opencode-store-token'), false)
  assert.equal(seen.commands.length, 0)
  seen.react.unmount()
})
