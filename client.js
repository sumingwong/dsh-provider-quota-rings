window.__ModuleLoader__.load({
  id: 'dsh-provider-quota-rings',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const COLORS = { codex: '#1f6b4a', claude: '#b35c2a', opencode: '#2a5f8a', grok: '#5c564e', glm: '#7a3e6d' }
    const COPY = {
      zh: {
        unknown: '未知',
        unavailable: '额度通道不可用。请确认宿主远程组件已启用。',
        badJson: '额度结果无法解析。',
        updated: '已读取。悬停查看各周期，数据来自缓存。五分钟会静默同步一次。',
        stored: 'GLM 密钥已写入本机钥匙串。',
        opencodeStored: 'OpenCode Go 密钥已写入本机钥匙串。',
        refresh: '刷新',
        disable: '停用',
        enable: '启用',
        close: '关闭',
        zhipu: '智谱',
        zai: 'Z.AI',
        liveOn: '关闭实时读取',
        liveOff: '开启实时读取',
        liveWarning: '实时读取默认关闭：打开后会调用本机 codex app-server、Claude 实验用量接口，以及已保存的 GLM / OpenCode 密钥。关掉后缓存会清空。',
        liveUnsupported: '当前宿主还在跑旧版本，重启 DeepSeek Harness 后这里会出现实时读取开关。',
        experimental: '实验来源，可以单独停用。',
        emptyWindows: '没有窗口。缺少的数量标为未知。',
        glmLabel: 'GLM 密钥（只进钥匙串，不要打在对话里）',
        opencodeLabel: 'OpenCode Go 密钥（只进钥匙串，不要打在对话里）',
        timeUnknown: '时间未知',
        resetPrefix: '距重置',
      },
      en: {
        unknown: 'Unknown',
        unavailable: 'The quota remote is unavailable.',
        badJson: 'The quota result could not be parsed.',
        updated: 'Read. Hover shows each period from the cache. A silent sync runs every five minutes.',
        stored: 'The GLM key was stored in the local keychain.',
        opencodeStored: 'The OpenCode Go key was stored in the local keychain.',
        refresh: 'Refresh',
        disable: 'Disable',
        enable: 'Enable',
        close: 'Close',
        zhipu: 'Zhipu',
        zai: 'Z.AI',
        liveOn: 'Turn live reads off',
        liveOff: 'Turn live reads on',
        liveWarning: 'Live reads are off by default: turning them on calls the local codex app-server, the experimental Claude usage API and the stored GLM / OpenCode keys. Turning them off clears the cache.',
        liveUnsupported: 'This host still runs an older build; restart DeepSeek Harness to get the live-reads switch.',
        experimental: 'Experimental source. It can be disabled on its own.',
        emptyWindows: 'No windows. Missing quantities stay unknown.',
        glmLabel: 'GLM key (keychain only, not chat)',
        opencodeLabel: 'OpenCode Go key (keychain only, not chat)',
        timeUnknown: 'time unknown',
        resetPrefix: 'Resets in',
      },
    }

    // Cordis throws on reading a service that was not declared in `inject`
    // ("cannot get property ... without inject"). ctx.get() reads a service
    // without claiming a dependency, which is what optional services and
    // self-mounted Remote namespaces need.
    function lateService(ctx, name) {
      try { return ctx.get(name, false) ?? null } catch { return null }
    }

    function localeCopy(ctx) {
      let id = 'zh'
      try {
        const locale = lateService(ctx, 'locale')
        const value = locale?.getLocale?.() ?? locale?.getSnapshot?.()
        id = String(value?.id ?? value ?? 'zh')
      } catch { id = 'zh' }
      return id.toLowerCase().startsWith('en') ? COPY.en : COPY.zh
    }

    const CALL_TIMEOUT = Symbol('call-timeout')

    function bounded(promise, ms) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(CALL_TIMEOUT), ms)
        promise.then(
          (value) => { clearTimeout(timer); resolve(value) },
          (error) => { clearTimeout(timer); reject(error) },
        )
      })
    }

    function strict(typeSymbol, parse) {
      return { mode: 'strict', typeSymbol, create: () => ({ parse }) }
    }

    function textParse(value) {
      if (typeof value !== 'string') throw new TypeError('参数必须是字符串')
      return value
    }

    function snapshotParse(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.rows)) {
        throw new TypeError('额度结果无法解析')
      }
      const banned = ['secret', 'token', 'password', 'authorization', 'apiKey', 'glmKey', 'opencodeKey', 'cookie', 'key', 'raw']
      const walk = (node) => {
        if (!node || typeof node !== 'object') return
        for (const [key, item] of Object.entries(node)) {
          if (banned.includes(key)) throw new TypeError('额度结果含有不能显示的字段')
          walk(item)
        }
      }
      walk(value)
      return value
    }

    function storeParse(value) {
      if (!value || typeof value !== 'object') throw new TypeError('保存结果无法解析')
      const message = String(value.message ?? '').slice(0, 160)
      return { ok: value.ok === true, message }
    }

    function quotaContribution(options = {}) {
      const direct = { kind: 'direct' }
      const text = strict('dsh-provider-quota-rings#Text', textParse)
      const flag = strict('dsh-provider-quota-rings#Flag', (value) => {
        if (typeof value !== 'boolean') throw new TypeError('参数必须是布尔值')
        return value
      })
      const snapshot = {
        mode: 'strict',
        typeSymbol: 'dsh-provider-quota-rings#QuotaSnapshot',
        create: () => ({ parse: snapshotParse }),
        decode: snapshotParse,
      }
      const stored = {
        mode: 'strict',
        typeSymbol: 'dsh-provider-quota-rings#StoreResult',
        create: () => ({ parse: storeParse }),
        decode: storeParse,
      }
      const base = {
        service: 'quotaRings',
        namespace: 'quotaRings',
        invocation: direct,
        cancellation: { parameter: 'signal' },
      }
      const descriptors = [
          { ...base, id: 'dsh-provider-quota-rings#quotaRings/read', method: 'read', parameters: [], result: snapshot },
          {
            ...base,
            id: 'dsh-provider-quota-rings#quotaRings/refresh',
            method: 'refresh',
            parameters: [{ name: 'providerId', wire: 'providerId', source: 'json', codec: text }],
            result: snapshot,
          },
          {
            ...base,
            id: 'dsh-provider-quota-rings#quotaRings/setDisabled',
            method: 'setDisabled',
            parameters: [
              { name: 'providerId', wire: 'providerId', source: 'json', codec: text },
              { name: 'disabled', wire: 'disabled', source: 'json', codec: flag },
            ],
            result: snapshot,
          },
          {
            ...base,
            id: 'dsh-provider-quota-rings#quotaRings/setPlatform',
            method: 'setPlatform',
            parameters: [{ name: 'platform', wire: 'platform', source: 'json', codec: text }],
            result: snapshot,
          },
          {
            ...base,
            id: 'dsh-provider-quota-rings#quotaRings/setLiveReads',
            method: 'setLiveReads',
            parameters: [{ name: 'enabled', wire: 'enabled', source: 'json', codec: flag }],
            result: snapshot,
          },
          {
            ...base,
            id: 'dsh-provider-quota-rings#quotaRings/storeGlmKey',
            method: 'storeGlmKey',
            parameters: [{ name: 'secret', wire: 'secret', source: 'json', codec: text }],
            result: stored,
          },
          {
            ...base,
            id: 'dsh-provider-quota-rings#quotaRings/storeOpenCodeKey',
            method: 'storeOpenCodeKey',
            parameters: [{ name: 'secret', wire: 'secret', source: 'json', codec: text }],
            result: stored,
          },
      ]
      return {
        package: 'dsh-provider-quota-rings',
        descriptors: options.withLiveReads === false
          ? descriptors.filter((descriptor) => descriptor.method !== 'setLiveReads')
          : descriptors,
      }
    }

    function ring(item, color) {
      const fraction = item.fraction
      const known = typeof fraction === 'number' && Number.isFinite(fraction)
      const percent = known ? Math.round(fraction * 100) : null
      return h('svg', {
        key: item.caption,
        viewBox: '0 0 36 36', width: 28, height: 28,
        'data-fraction': known ? String(fraction) : 'unknown',
        'data-caption': item.caption ?? '',
        role: 'img',
        'aria-label': known ? `${item.caption} 剩余 ${percent}%` : '未知',
      }, h('circle', {
        cx: 18, cy: 18, r: 14, fill: 'none', stroke: '#d9d3cb', strokeWidth: 3,
        strokeDasharray: known ? undefined : '2 3',
      }), known ? h('circle', {
        cx: 18, cy: 18, r: 14, fill: 'none', stroke: color, strokeWidth: 3,
        strokeDasharray: `${(fraction * 87.96).toFixed(2)} 87.96`,
        strokeLinecap: 'round', transform: 'rotate(-90 18 18)',
      }) : null, h('text', {
        x: 18, y: 20, textAnchor: 'middle', fontSize: known ? 8 : 11, fill: '#1c1916',
      }, known ? String(percent) : '?'))
    }

    const CLIENT_SYNC_MS = 5 * 60 * 1000
    const CARD_OVERLAP_PX = 8

    function card(row, copy, anchor) {
      const color = COLORS[row.id] ?? '#1c1916'
      const fixed = anchor?.id === row.id && typeof anchor.top === 'number' && typeof anchor.left === 'number'
      const top = fixed ? Math.max(8, anchor.top + CARD_OVERLAP_PX) : undefined
      const viewportWidth = typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0
        ? window.innerWidth
        : null
      const cardWidth = viewportWidth == null ? null : Math.min(280, viewportWidth * 0.7)
      const maxLeft = viewportWidth == null || cardWidth == null ? null : Math.max(8, viewportWidth - cardWidth - 8)
      const left = fixed
        ? (maxLeft == null ? Math.max(8, anchor.left) : Math.min(Math.max(8, anchor.left), maxLeft))
        : 0
      return h('div', {
        'data-hover-card': row.id,
        'data-card-position': fixed ? 'fixed' : 'absolute',
        'data-overlap': String(CARD_OVERLAP_PX),
        role: 'tooltip',
        tabIndex: 0,
        style: {
          position: fixed ? 'fixed' : 'absolute',
          bottom: fixed ? undefined : `calc(100% - ${CARD_OVERLAP_PX}px)`,
          left,
          top,
          transform: fixed ? 'translateY(-100%)' : undefined,
          zIndex: 40,
          width: 'min(280px, 70vw)',
          maxHeight: '60vh',
          overflow: 'auto',
          background: '#fff',
          color: '#1c1916',
          border: '1px solid #e4ddd4',
          borderRadius: 12,
          boxShadow: '0 8px 24px rgba(40, 30, 20, 0.12)',
          padding: '10px 12px',
        },
      }, h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'data-icon': row.id, 'aria-hidden': 'true' },
          h('circle', { cx: 8, cy: 8, r: 6, fill: color })),
        h('strong', null, row.label),
        row.platformLabel ? h('span', null, row.platformLabel) : null),
      h('p', { 'data-card-status': '1', style: { margin: '6px 0', fontSize: 12 } }, row.statusText),
      (row.windows ?? []).map((window, index) => {
        const known = typeof window.fraction === 'number' && Number.isFinite(window.fraction)
        return h('div', {
          key: `${window.label}-${index}`,
          'data-window': window.label,
          'data-scope': window.scope ?? '',
          style: { marginTop: 8 },
        }, h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 } },
          h('span', null, `${window.scopeText || copy.unknown} · ${window.label}`),
          h('span', { 'data-remaining': window.remainingText || copy.unknown }, window.remainingText || copy.unknown)),
        h('span', {
          'data-remaining-bar': known ? String(window.fraction) : 'unknown',
          style: { display: 'block', height: 6, background: '#ece7e1', borderRadius: 99, overflow: 'hidden', margin: '4px 0' },
        }, known ? h('span', {
          style: { display: 'block', width: `${Math.round(window.fraction * 100)}%`, height: '100%', background: color },
        }) : null),
        h('div', { style: { fontSize: 12, color: '#5c564e' } }, `${copy.resetPrefix} ${window.resetDistanceText || copy.unknown}`),
        window.showQuantity ? h('div', { 'data-quantity': '1', style: { fontSize: 12 } }, window.quantityText) : null)
      }),
      (row.windows ?? []).length === 0 ? h('p', null, copy.emptyWindows) : null)
    }

    function bridge(row, anchor) {
      const fixed = anchor?.id === row.id && typeof anchor.top === 'number' && typeof anchor.left === 'number'
      return h('div', {
        'data-hover-bridge': row.id,
        'aria-hidden': 'true',
        style: {
          position: fixed ? 'fixed' : 'absolute',
          left: fixed ? Math.max(8, anchor.left) : 0,
          top: fixed ? Math.max(0, anchor.top - 2) : undefined,
          bottom: fixed ? undefined : '100%',
          width: fixed ? Math.max(28, anchor.width || 40) : '100%',
          height: 12,
          background: 'transparent',
        },
      })
    }

    return {
      inject: ['slots', 'remote'],
      apply(ctx) {
        const copy = localeCopy(ctx)
        const localeService = lateService(ctx, 'locale')
        if (localeService && typeof localeService.register === 'function') {
          try { localeService.register('dsh-provider-quota-rings', { zh: COPY.zh, en: COPY.en }) } catch { /* locale is optional */ }
        }
        const controllers = new Set()
        const disposers = []
        let alive = true
        let mountTask = null
        let liveToggle = false
        const stop = () => {
          alive = false
          for (const controller of controllers) controller.abort()
          controllers.clear()
          for (const dispose of disposers.splice(0)) {
            try { void dispose?.() } catch { /* already released */ }
          }
        }
        if (typeof ctx.effect === 'function') ctx.effect(() => stop)

        function mountRemote() {
          if (!mountTask) {
            mountTask = (async () => {
              if (typeof ctx.remote?.$mount !== 'function') throw new Error('mount')
              // The live-read authorization endpoint is newer than the rings themselves.
              // A host that predates it rejects the whole contribution, so retry with the
              // core surface only and hide a button that cannot do anything.
              let dispose
              try {
                dispose = await ctx.remote.$mount(quotaContribution())
                liveToggle = true
              } catch (error) {
                if (error instanceof Error && error.message === 'mount') throw error
                try { void dispose?.() } catch {}
                dispose = await ctx.remote.$mount(quotaContribution({ withLiveReads: false }))
                liveToggle = false
              }
              if (!alive) {
                await dispose?.()
                throw new Error('unmounted')
              }
              if (typeof dispose === 'function') disposers.push(dispose)
              // This plugin mounts the quotaRings namespace itself, so it cannot list
              // `remote.quotaRings` in its module-level inject (that would wait on
              // itself forever). Read it right after mounting instead.
              let api = null
              for (let attempt = 0; attempt < 40 && !api; attempt += 1) {
                api = lateService(ctx, 'remote.quotaRings')
                if (!api) await new Promise((resolve) => setTimeout(resolve, 25))
              }
              if (typeof api?.read !== 'function') throw new Error('read')
              return api
            })().catch((error) => {
              mountTask = null
              throw error
            })
          }
          return mountTask
        }

        function QuotaFooter({ wide = true }) {
          const [model, setModel] = React.useState(null)
          const [notice, setNotice] = React.useState(copy.unknown)
          const [openId, setOpenId] = React.useState(null)
          const [pointerId, setPointerId] = React.useState(null)
          const [focusId, setFocusId] = React.useState(null)
          const [anchor, setAnchor] = React.useState(null)
          const dialogRef = React.useRef(null)
          const generation = React.useRef(0)
          const run = React.useCallback(async (action) => {
            if (!alive) return
            if (action?.kind === 'read' && action?.silent && controllers.size > 0) return
            const gen = ++generation.current
            const life = new AbortController()
            controllers.add(life)
            const current = () => alive && !life.signal.aborted && gen === generation.current
            try {
              const api = await mountRemote()
              if (!current()) return
              let result
              if (!action || action.kind === 'read') result = await api.read(life.signal)
              else if (action.kind === 'refresh') result = await api.refresh(action.id ?? '', life.signal)
              else if (action.kind === 'disable') result = await api.setDisabled(action.id, true, life.signal)
              else if (action.kind === 'enable') result = await api.setDisabled(action.id, false, life.signal)
              else if (action.kind === 'platform') result = await api.setPlatform(action.platform, life.signal)
              else if (action.kind === 'liveReads') {
                result = await bounded(Promise.resolve(api.setLiveReads(action.value === true, life.signal)), 4000)
                if (result === CALL_TIMEOUT) {
                  // The host mounted the endpoint but never answered: an older build whose
                  // service object predates it. Hide the button instead of lying about it.
                  liveToggle = false
                  if (current()) setNotice(copy.liveUnsupported)
                  return
                }
              }
              else if (action.kind === 'store') {
                result = action.target === 'opencode'
                  ? await api.storeOpenCodeKey(action.secret, life.signal)
                  : await api.storeGlmKey(action.secret, life.signal)
                if (!current()) return
                const saved = result?.ok ? result.value : null
                const message = String(saved?.message || copy.unavailable)
                const fallback = action.target === 'opencode' ? copy.opencodeStored : copy.stored
                setNotice(action.secret && message.includes(action.secret) ? fallback : message.slice(0, 160))
                if (saved?.ok === true && current()) await run({ kind: 'read' })
                return
              } else {
                setNotice(copy.unavailable)
                return
              }
              if (!current()) return
              if (!result?.ok || !result.value || !Array.isArray(result.value.rows)) {
                if (!action?.silent) setNotice(result?.ok === false ? copy.unavailable : copy.badJson)
                return
              }
              setModel(result.value)
              if (!action?.silent) setNotice(copy.updated)
            } catch {
              if (!action?.silent && current()) setNotice(copy.badJson)
            } finally {
              controllers.delete(life)
            }
          }, [])
          React.useEffect(() => {
            run({ kind: 'read' })
            const timer = setInterval(() => {
              run({ kind: 'read', silent: true })
            }, CLIENT_SYNC_MS)
            return () => {
              clearInterval(timer)
              for (const controller of controllers) controller.abort()
            }
          }, [run])
          React.useEffect(() => {
            const node = dialogRef.current
            if (!node) return undefined
            if (openId && !node.open) node.showModal()
            if (!openId && node.open) node.close()
            return undefined
          }, [openId, model])
          const rows = model?.rows ?? []
          const selected = rows.find((row) => row.id === openId) ?? null
          return h('div', {
            'data-quota-rings': 'footer',
            'data-wide': wide ? '1' : '0',
            'data-glm-stored': model?.glmKeyStored ? '1' : '0',
            'data-opencode-stored': model?.opencodeKeyStored ? '1' : '0',
            style: { display: 'flex', gap: 8, alignItems: 'end', padding: '4px 8px', overflow: 'visible' },
          }, rows.map((row) => {
            const open = pointerId === row.id || focusId === row.id
            return h('div', {
              key: row.id,
              style: { position: 'relative' },
              onMouseEnter: (event) => {
                setPointerId(row.id)
                const rect = event?.currentTarget?.getBoundingClientRect?.()
                if (rect && Number.isFinite(rect.top) && Number.isFinite(rect.left)) {
                  setAnchor({
                    id: row.id,
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height,
                    bottom: rect.bottom,
                  })
                }
              },
              onMouseLeave: () => setPointerId((current) => (current === row.id ? null : current)),
              onFocus: () => setFocusId(row.id),
              onBlur: (event) => {
                const next = event?.relatedTarget
                const container = event?.currentTarget
                if (next && container && typeof container.contains === 'function' && container.contains(next)) return
                setFocusId((current) => (current === row.id ? null : current))
              },
            }, open ? bridge(row, anchor) : null, h('button', {
              type: 'button',
              'data-provider': row.id,
              'data-status': row.status,
              onClick: () => setOpenId(row.id),
              style: { border: 0, background: 'transparent', color: COLORS[row.id], cursor: 'pointer', padding: 0 },
            }, h('span', { style: { display: 'flex', gap: 2 } }, (row.rings ?? []).map((item) => ring(
              row.status === 'disabled' ? { ...item, fraction: null, caption: '已停用' } : item,
              COLORS[row.id],
            ))),
            wide ? h('span', { style: { display: 'block', fontSize: 10, color: '#1c1916' } }, row.label) : null),
            open ? card(row, copy, anchor) : null)
          }),
          h('span', {
            'data-notice': '1',
            role: 'status',
            'aria-live': 'polite',
            style: {
              position: 'absolute',
              width: 1,
              height: 1,
              margin: -1,
              padding: 0,
              border: 0,
              overflow: 'hidden',
              clip: 'rect(0 0 0 0)',
              whiteSpace: 'nowrap',
            },
          }, notice),
          h('dialog', {
            ref: dialogRef,
            'data-quota-dialog': selected?.id ?? '',
            'aria-label': selected ? `${selected.label} 额度` : '额度',
            onClose: () => setOpenId(null),
          }, selected ? h('div', null,
            h('strong', null, selected.label),
            selected.platformLabel ? h('span', null, ` ${selected.platformLabel}`) : null,
            h('p', null, selected.statusText),
            liveToggle ? h('button', {
              type: 'button',
              'data-action': 'liveReads',
              'data-live-reads': model?.liveReads === true ? '1' : '0',
              onClick: () => run({ kind: 'liveReads', value: model?.liveReads !== true }),
            }, model?.liveReads === true ? copy.liveOn : copy.liveOff) : null,
            liveToggle && model?.liveReads !== true ? h('p', { 'data-action': 'liveHint' }, copy.liveWarning) : null,
            liveToggle || !model ? null : h('p', { 'data-action': 'liveUnsupported' }, copy.liveUnsupported),
            selected.source ? h('p', { 'data-source': '1' }, selected.source) : null,
            selected.experimental ? h('p', null, copy.experimental) : null,
            selected.note ? h('p', null, selected.note) : null,
            h('ul', null, (selected.windows ?? []).map((window) => h('li', { key: window.label },
              `${window.label} · ${window.scopeText} · 剩余 ${window.remainingText} · 重置 ${window.resetText} · ${window.quantityLabel || '数量'} ${window.quantityText}`))),
            (selected.windows ?? []).length === 0 ? h('p', null, copy.emptyWindows) : null,
            selected.link ? h('a', { href: selected.link.href, target: '_blank', rel: 'noreferrer' }, selected.link.label) : null,
            h('button', { type: 'button', 'data-action': 'refresh', onClick: () => run({ kind: 'refresh', id: selected.id }) }, copy.refresh),
            h('button', { type: 'button', 'data-action': 'disable', onClick: () => run({ kind: selected.status === 'disabled' ? 'enable' : 'disable', id: selected.id }) }, selected.status === 'disabled' ? copy.enable : copy.disable),
            selected.id === 'glm' ? h('button', { type: 'button', onClick: () => run({ kind: 'platform', platform: 'zhipu' }) }, copy.zhipu) : null,
            selected.id === 'glm' ? h('button', { type: 'button', onClick: () => run({ kind: 'platform', platform: 'zai' }) }, copy.zai) : null,
            selected.id === 'glm' ? h('form', {
              onSubmit: (event) => {
                event.preventDefault()
                const value = String(event.target.elements.glmKey?.value ?? '')
                event.target.reset()
                if (value) run({ kind: 'store', target: 'glm', secret: value })
              },
            }, h('label', null, copy.glmLabel), h('input', { name: 'glmKey', type: 'password', autoComplete: 'off' })) : null,
            selected.id === 'opencode' ? h('form', {
              onSubmit: (event) => {
                event.preventDefault()
                const value = String(event.target.elements.opencodeKey?.value ?? '')
                event.target.reset()
                if (value) run({ kind: 'store', target: 'opencode', secret: value })
              },
            }, h('label', null, copy.opencodeLabel), h('input', { name: 'opencodeKey', type: 'password', autoComplete: 'off' })) : null,
            h('button', { type: 'button', onClick: () => setOpenId(null) }, copy.close)) : null))
        }
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'provider-quota-rings',
          order: 40,
        }, QuotaFooter))
      },
    }
  },
})
