window.__ModuleLoader__.load({
  id: 'dsh-provider-quota-rings',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const ACCENT = '#12a15b'
    const TRACK = '#e6e3dd'
    const INK = '#1c1916'
    const MUTED = '#6b655d'

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
        ringHint: '圆环越满，剩余越多。内环是最短的周期，外环是最长的周期。',
        sectionLabel: '额度圆环',
        settingsIntro: '侧栏只显示本机 DSH 已配置模型路由的提供商。',
        liveTitle: '实时读取',
        liveStateOn: '已开启',
        liveStateOff: '已关闭',
        detectedTitle: '检测到的模型路由',
        detectedNone: '没有检测到匹配的模型路由。',
        detectedUnavailable: '读不到 LLM 路由表，暂时按全部提供商显示。',
        ringsTitle: '当前圆环',
        noRings: '没有可显示的圆环。',
        keysTitle: '密钥',
        save: '保存',
        hint: '说明',
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
        liveOff: 'Turn live reads on',
        liveOn: 'Turn live reads off',
        liveWarning: 'Live reads are off by default: turning them on calls the local codex app-server, the experimental Claude usage API and the stored GLM / OpenCode keys. Turning them off clears the cache.',
        liveUnsupported: 'This host still runs an older build; restart DeepSeek Harness to get the live-reads switch.',
        experimental: 'Experimental source. It can be disabled on its own.',
        emptyWindows: 'No windows. Missing quantities stay unknown.',
        glmLabel: 'GLM key (keychain only, not chat)',
        opencodeLabel: 'OpenCode Go key (keychain only, not chat)',
        timeUnknown: 'time unknown',
        resetPrefix: 'Resets in',
        ringHint: 'A fuller ring means more remaining. The inner ring is the shortest period, the outer ring the longest.',
        sectionLabel: 'Quota rings',
        settingsIntro: 'The sidebar only shows providers whose model route is configured in this DSH install.',
        liveTitle: 'Live reads',
        liveStateOn: 'on',
        liveStateOff: 'off',
        detectedTitle: 'Detected model routes',
        detectedNone: 'No matching model route was detected.',
        detectedUnavailable: 'The LLM route table could not be read, so every provider is shown.',
        ringsTitle: 'Current rings',
        noRings: 'No ring to show.',
        keysTitle: 'Keys',
        save: 'Save',
        hint: 'Note',
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
    const OPENAI_PATH = 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z'
    const CLAUDE_PATH = 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'

    // Brand marks are monochrome so one ink colour works on both themes.
    // OpenAI and Claude come from Simple Icons (24x24, scaled into the 40-box);
    // the rest are drawn as plain geometry, no font or network asset.
    const BRAND = {
      codex: OPENAI_PATH,
      claude: CLAUDE_PATH,
    }

    function brandGroup(id) {
      const path = BRAND[id]
      if (path) {
        return h('path', { d: path, fill: INK, transform: 'translate(13.6 13.6) scale(0.5333)' })
      }
      if (id === 'grok') {
        return h('path', {
          d: 'M14 14 L26 26 M26 14 L14 26',
          fill: 'none', stroke: INK, strokeWidth: 2.6, strokeLinecap: 'round',
        })
      }
      if (id === 'opencode') {
        return h('path', {
          d: 'M14.5 14.8 L20.2 20 L14.5 25.2 M21.6 25.2 H26',
          fill: 'none', stroke: INK, strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round',
        })
      }
      if (id === 'glm') {
        return h('path', {
          d: 'M14.4 14.6 H25.6 L14.4 25.4 H25.6',
          fill: 'none', stroke: INK, strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round',
        })
      }
      return h('circle', { cx: 20, cy: 20, r: 4.4, fill: INK })
    }

    function BrandIcon({ id, size = 14 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 40 40', 'aria-hidden': 'true', focusable: 'false',
      }, brandGroup(id))
    }

    const R_OUT = 16.2
    const R_IN = 10.2
    const RING_W = 3.1
    const C_OUT = 2 * Math.PI * R_OUT
    const C_IN = 2 * Math.PI * R_IN

    function percentOf(item) {
      const fraction = item?.fraction
      if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return null
      return Math.round(Math.min(1, Math.max(0, fraction)) * 100)
    }

    function trackCircle(radius, dashed, key) {
      return h('circle', {
        key,
        cx: 20, cy: 20, r: radius, fill: 'none', stroke: TRACK, strokeWidth: RING_W,
        strokeDasharray: dashed ? '2 3' : undefined,
      })
    }

    function arcCircle(radius, circumference, item, color, key) {
      const percent = percentOf(item)
      if (percent === null) return null
      return h('circle', {
        key,
        cx: 20, cy: 20, r: radius, fill: 'none', stroke: color, strokeWidth: RING_W,
        strokeDasharray: `${((percent / 100) * circumference).toFixed(2)} ${circumference.toFixed(2)}`,
        strokeLinecap: 'round',
        transform: 'rotate(-90 20 20)',
      })
    }

    function pair(row) {
      const rings = Array.isArray(row.rings) ? row.rings.filter(Boolean).slice(0, 2) : []
      // Two known periods: the short one is the inner ring, the long one the
      // outer ring. A single period keeps the outer ring so it stays readable.
      if (rings.length >= 2) return { inner: rings[0], outer: rings[1] }
      return { inner: null, outer: rings[0] ?? null }
    }

    function ringWords(row, copy) {
      const { inner, outer } = pair(row)
      const part = (item) => {
        if (!item) return null
        const percent = percentOf(item)
        return `${item.caption || copy.unknown} ${percent === null ? copy.unknown : `${percent}%`}`
      }
      return [part(inner), part(outer)].filter(Boolean).join(' · ') || copy.unknown
    }

    function ProviderRing({ row, copy }) {
      const { inner, outer } = pair(row)
      const off = row.status === 'disabled'
      const color = off ? '#a8a29a' : ACCENT
      return h('svg', {
        viewBox: '0 0 40 40',
        width: 40,
        height: 40,
        role: 'img',
        'aria-label': `${row.label} ${ringWords(row, copy)}`,
        'data-provider-ring': row.id,
        'data-inner': percentOf(inner) === null ? 'unknown' : String(percentOf(inner)),
        'data-outer': percentOf(outer) === null ? 'unknown' : String(percentOf(outer)),
        style: { display: 'block', flex: '0 0 auto' },
      },
        trackCircle(R_OUT, percentOf(outer) === null, 'track-outer'),
        trackCircle(R_IN, percentOf(inner) === null, 'track-inner'),
        arcCircle(R_OUT, C_OUT, outer, color, 'arc-outer'),
        arcCircle(R_IN, C_IN, inner, color, 'arc-inner'),
        h('g', null, brandGroup(row.id)),
      )
    }

    function percentLegend(row) {
      const { inner, outer } = pair(row)
      const one = (item) => {
        const percent = percentOf(item)
        return percent === null ? '—' : `${percent}%`
      }
      const parts = [inner, outer].filter(Boolean).map(one)
      return parts.length ? parts.join(' · ') : ''
    }

    const CLIENT_SYNC_MS = 5 * 60 * 1000
    const CARD_OVERLAP_PX = 8

    function card(row, copy, anchor) {
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
          color: INK,
          border: '1px solid #e4ddd4',
          borderRadius: 12,
          boxShadow: '0 8px 24px rgba(40, 30, 20, 0.12)',
          padding: '10px 12px',
        },
      }, h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        h(BrandIcon, { id: row.id, size: 16 }),
        h('strong', null, row.label),
        row.platformLabel ? h('span', null, row.platformLabel) : null),
      h('p', { 'data-card-status': '1', style: { margin: '6px 0', fontSize: 12 } }, row.statusText),
      h('p', { 'data-card-rings': '1', style: { margin: '6px 0', fontSize: 12, color: MUTED } }, ringWords(row, copy)),
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
          style: { display: 'block', width: `${Math.round(window.fraction * 100)}%`, height: '100%', background: ACCENT },
        }) : null),
        h('div', { style: { fontSize: 12, color: MUTED } }, `${copy.resetPrefix} ${window.resetDistanceText || copy.unknown}`),
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

        // ---- shared snapshot state (footer and settings read the same store) ----
        let model = null
        let notice = copy.unknown
        let revision = 0
        const listeners = new Set()
        const stateOf = () => ({ model, notice, liveToggle, revision })
        const publish = () => {
          revision += 1
          const snapshot = stateOf()
          for (const listener of [...listeners]) {
            try { listener(snapshot) } catch { /* a dead subscriber must not stop the rest */ }
          }
        }
        const subscribe = (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        }
        const useQuota = () => {
          const [snapshot, setSnapshot] = React.useState(stateOf)
          React.useEffect(() => {
            const off = subscribe(setSnapshot)
            setSnapshot(stateOf())
            return off
          }, [])
          return snapshot
        }

        let generation = 0
        async function run(action) {
          if (!alive) return
          if (action?.kind === 'read' && action?.silent && controllers.size > 0) return
          const gen = ++generation
          const life = new AbortController()
          controllers.add(life)
          const current = () => alive && !life.signal.aborted && gen === generation
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
                if (current()) notice = copy.liveUnsupported
                return
              }
            } else if (action.kind === 'store') {
              result = action.target === 'opencode'
                ? await api.storeOpenCodeKey(action.secret, life.signal)
                : await api.storeGlmKey(action.secret, life.signal)
              if (!current()) return
              const saved = result?.ok ? result.value : null
              const message = String(saved?.message || copy.unavailable).slice(0, 160)
              const fallback = action.target === 'opencode' ? copy.opencodeStored : copy.stored
              const text = action.secret && message.includes(action.secret) ? fallback : message
              if (saved?.ok === true) {
                await run({ kind: 'read', silent: true })
                notice = text
              } else {
                notice = text
              }
              return
            } else {
              notice = copy.unavailable
              return
            }
            if (!current()) return
            if (!result?.ok || !result.value || !Array.isArray(result.value.rows)) {
              notice = result?.ok === false ? copy.unavailable : copy.badJson
              return
            }
            model = result.value
            if (!action?.silent) notice = copy.updated
          } catch {
            if (alive) notice = copy.badJson
          } finally {
            controllers.delete(life)
            publish()
          }
        }

        function QuotaFooter({ wide = true }) {
          const state = useQuota()
          const [hoverId, setHoverId] = React.useState(null)
          const [focusId, setFocusId] = React.useState(null)
          const [anchor, setAnchor] = React.useState(null)
          const [openId, setOpenId] = React.useState(null)
          const [glmValue, setGlmValue] = React.useState('')
          const [openValue, setOpenValue] = React.useState('')
          const dialogRef = React.useRef(null)

          React.useEffect(() => {
            if (!alive) return undefined
            void run({ kind: 'read' })
            const timer = setInterval(() => { void run({ kind: 'read', silent: true }) }, CLIENT_SYNC_MS)
            return () => clearInterval(timer)
          }, [])

          React.useEffect(() => {
            const dialog = dialogRef.current
            if (!dialog) return
            if (openId && typeof dialog.showModal === 'function') {
              if (!dialog.open) dialog.showModal()
            } else if (!openId && typeof dialog.close === 'function' && dialog.open) {
              dialog.close()
            }
          }, [openId])

          const rows = state.model?.rows ?? []
          const openRow = rows.find((row) => row.id === openId) ?? null

          const show = (id, element) => {
            setHoverId(id)
            const rect = element && typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null
            if (rect) setAnchor({ id, top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width) })
          }
          const hide = () => { setHoverId(null); setFocusId(null) }

          const buttonStyle = { border: '1px solid ' + TRACK, background: 'transparent', color: INK, borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }
          const bar = (window, index) => {
            const known = typeof window.fraction === 'number' && Number.isFinite(window.fraction)
            return h('div', { key: `${window.label}-${index}`, 'data-window': window.label, 'data-scope': window.scope ?? '', style: { marginTop: 8 } },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 } },
                h('span', null, `${window.scopeText || copy.unknown} · ${window.label}`),
                h('span', { 'data-remaining': window.remainingText || copy.unknown }, window.remainingText || copy.unknown)),
              h('span', {
                'data-remaining-bar': known ? String(window.fraction) : 'unknown',
                style: { display: 'block', height: 6, background: '#ece7e1', borderRadius: 99, overflow: 'hidden', margin: '4px 0' },
              }, known ? h('span', { style: { display: 'block', width: `${Math.round(window.fraction * 100)}%`, height: '100%', background: ACCENT } }) : null),
              h('div', { style: { fontSize: 12, color: MUTED } }, `${copy.resetPrefix} ${window.resetDistanceText || copy.unknown}`))
          }

          const keyForm = (label, value, setValue, target) => h('form', {
            key: target,
            onSubmit: (event) => {
              event.preventDefault()
              const next = value.trim()
              if (!next) return
              setValue('')
              void run({ kind: 'store', target, secret: next })
            },
            style: { display: 'flex', gap: 6, marginTop: 6 },
          },
            h('input', {
              type: 'password',
              value,
              placeholder: label,
              'aria-label': label,
              onChange: (event) => setValue(event.target.value),
              style: { flex: '1 1 auto', minWidth: 0, padding: '4px 6px', border: '1px solid ' + TRACK, borderRadius: 6, background: 'transparent', color: INK, fontSize: 12 },
            }),
            h('button', { type: 'submit', style: buttonStyle }, copy.save))

          return h('div', {
            'data-quota-rings': 'footer',
            'data-provider-count': String(rows.length),
            style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 0', position: 'relative' },
          },
            rows.map((row) => {
              const open = hoverId === row.id || focusId === row.id
              return h('div', {
                key: row.id,
                'data-provider-row': row.id,
                style: { position: 'relative', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
                onMouseEnter: (event) => show(row.id, event.currentTarget),
                onMouseLeave: hide,
                onFocus: (event) => { setFocusId(row.id); show(row.id, event.currentTarget) },
                onBlur: () => setFocusId(null),
              },
                open ? bridge(row, anchor) : null,
                h('button', {
                  type: 'button',
                  'data-ring-button': row.id,
                  'aria-label': `${row.label} ${ringWords(row, copy)}`,
                  onClick: () => setOpenId(row.id),
                  style: { border: 0, background: 'transparent', padding: 0, cursor: 'pointer', borderRadius: 999, lineHeight: 0 },
                }, h(ProviderRing, { row, copy })),
                wide ? h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.25 } },
                  h('span', { style: { fontSize: 11, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, row.label),
                  h('span', { 'data-percent': percentLegend(row), style: { fontSize: 10, color: MUTED } }, percentLegend(row) || copy.unknown)) : null,
                open ? card(row, copy, anchor) : null)
            }),
            rows.length === 0 ? h('span', { 'data-quota-empty': '1', style: { fontSize: 10, color: MUTED } }, state.model ? copy.noRings : copy.unknown) : null,
            h('span', {
              'data-notice': '1',
              role: 'status',
              'aria-live': 'polite',
              style: { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 },
            }, state.notice),
            h('dialog', {
              ref: dialogRef,
              'data-quota-dialog': '1',
              onClose: () => setOpenId(null),
              style: { border: '1px solid #e4ddd4', borderRadius: 14, padding: '14px 16px', background: '#fff', color: INK, boxShadow: '0 12px 32px rgba(40, 30, 20, 0.18)' },
            },
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, width: 'min(340px, 82vw)' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  openRow ? h(BrandIcon, { id: openRow.id, size: 18 }) : null,
                  h('strong', null, openRow?.label ?? copy.sectionLabel),
                  h('span', { style: { marginLeft: 'auto', fontSize: 11, color: MUTED } }, openRow ? percentLegend(openRow) : '')),
                h('p', { style: { margin: 0, fontSize: 12, color: MUTED } }, openRow?.statusText ?? copy.unavailable),
                (openRow?.windows ?? []).map(bar),
                h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 } },
                  openRow ? h('button', { type: 'button', onClick: () => { void run({ kind: 'refresh', id: openRow.id }) }, style: buttonStyle }, copy.refresh) : null,
                  openRow ? h('button', {
                    type: 'button',
                    onClick: () => { void run({ kind: openRow.status === 'disabled' ? 'enable' : 'disable', id: openRow.id }) },
                    style: buttonStyle,
                  }, openRow.status === 'disabled' ? copy.enable : copy.disable) : null,
                  liveToggle ? h('button', {
                    type: 'button',
                    onClick: () => { void run({ kind: 'liveReads', value: state.model?.liveReads !== true }) },
                    style: buttonStyle,
                  }, state.model?.liveReads ? copy.liveOn : copy.liveOff) : null,
                  h('button', { type: 'button', onClick: () => setOpenId(null), style: buttonStyle }, copy.close)),
                liveToggle ? null : h('p', { style: { margin: 0, fontSize: 11, color: MUTED } }, copy.liveUnsupported),
                h('div', { style: { display: 'flex', gap: 6, marginTop: 2 } },
                  h('button', { type: 'button', onClick: () => { void run({ kind: 'platform', platform: 'zhipu' }) }, style: buttonStyle }, copy.zhipu),
                  h('button', { type: 'button', onClick: () => { void run({ kind: 'platform', platform: 'zai' }) }, style: buttonStyle }, copy.zai)),
                keyForm(copy.glmLabel, glmValue, setGlmValue, 'glm'),
                keyForm(copy.opencodeLabel, openValue, setOpenValue, 'opencode'),
                h('p', { style: { margin: 0, fontSize: 11, color: MUTED } }, copy.experimental))))
        }

        function QuotaSettings({ close }) {
          const state = useQuota()
          const [glmValue, setGlmValue] = React.useState('')
          const [openValue, setOpenValue] = React.useState('')
          React.useEffect(() => { void run({ kind: 'read', silent: true }) }, [])

          const model = state.model
          const rows = model?.rows ?? []
          const detected = model?.detected ?? null
          const buttonStyle = { border: '1px solid ' + TRACK, background: 'transparent', color: INK, borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }
          const muted = { margin: 0, fontSize: 12, color: MUTED }
          const section = (key, title, children) => h('section', {
            key,
            'data-quota-section': key,
            style: { display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '1px solid ' + TRACK },
          },
            h('h3', { style: { margin: 0, fontSize: 13, fontWeight: 600, color: INK } }, title),
            ...children)

          const keyForm = (target, label, value, setValue) => h('form', {
            key: target,
            onSubmit: (event) => {
              event.preventDefault()
              const next = value.trim()
              if (!next) return
              setValue('')
              void run({ kind: 'store', target, secret: next })
            },
            style: { display: 'flex', gap: 6, marginTop: 6 },
          },
            h('input', {
              type: 'password',
              value,
              placeholder: label,
              'aria-label': label,
              onChange: (event) => setValue(event.target.value),
              style: { flex: '1 1 auto', minWidth: 0, padding: '4px 6px', border: '1px solid ' + TRACK, borderRadius: 6, background: 'transparent', color: INK, fontSize: 12 },
            }),
            h('button', { type: 'submit', style: buttonStyle }, copy.save))

          return h('section', {
            'data-quota-settings': '1',
            style: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560, paddingBottom: 8 },
          },
            h('header', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              h('h2', { style: { margin: 0, fontSize: 15, fontWeight: 600, color: INK } }, copy.sectionLabel),
              h('p', muted, copy.settingsIntro),
              h('p', muted, copy.ringHint)),
            section('live', copy.liveTitle, [
              h('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                state.liveToggle
                  ? h('button', {
                    type: 'button',
                    'data-settings-action': 'liveReads',
                    onClick: () => { void run({ kind: 'liveReads', value: model?.liveReads !== true }) },
                    style: buttonStyle,
                  }, model?.liveReads ? copy.liveOn : copy.liveOff)
                  : h('span', { key: 'off', style: { fontSize: 12, color: MUTED } }, copy.liveUnsupported),
                h('span', { style: { fontSize: 12, color: MUTED } }, model ? (model.liveReads ? copy.liveStateOn : copy.liveStateOff) : copy.unknown)),
              h('p', { key: 'note', style: muted }, model?.liveReads ? copy.hint : copy.liveWarning),
            ]),
            section('detected', copy.detectedTitle, [
              detected
                ? (detected.routes.length
                  ? h('ul', { key: 'list', style: { margin: 0, paddingLeft: 18, fontSize: 12, color: INK } }, detected.routes.map((route) => h('li', { key: route }, route)))
                  : h('p', { key: 'none', style: muted }, copy.detectedNone))
                : h('p', { key: 'unknown', style: muted }, copy.detectedUnavailable),
            ]),
            section('rings', copy.ringsTitle, rows.length
              ? rows.map((row) => h('div', { key: row.id, 'data-settings-provider': row.id, style: { display: 'flex', alignItems: 'center', gap: 10 } },
                h(ProviderRing, { row, copy }),
                h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
                  h('strong', { style: { fontSize: 12, color: INK } }, row.label),
                  h('span', { style: { fontSize: 11, color: MUTED } }, row.statusText)),
                h('span', { style: { marginLeft: 'auto', fontSize: 12, color: MUTED } }, percentLegend(row)),
                h('button', {
                  type: 'button',
                  onClick: () => { void run({ kind: row.status === 'disabled' ? 'enable' : 'disable', id: row.id }) },
                  style: buttonStyle,
                }, row.status === 'disabled' ? copy.enable : copy.disable)))
              : [h('p', { key: 'empty', style: muted }, copy.noRings)]),
            section('keys', copy.keysTitle, [
              keyForm('glm', copy.glmLabel, glmValue, setGlmValue),
              keyForm('opencode', copy.opencodeLabel, openValue, setOpenValue),
              h('div', { key: 'platform', style: { display: 'flex', gap: 6, marginTop: 2 } },
                h('button', { type: 'button', onClick: () => { void run({ kind: 'platform', platform: 'zhipu' }) }, style: buttonStyle }, copy.zhipu),
                h('button', { type: 'button', onClick: () => { void run({ kind: 'platform', platform: 'zai' }) }, style: buttonStyle }, copy.zai)),
            ]),
            h('div', { style: { display: 'flex', gap: 8, paddingTop: 12, borderTop: '1px solid ' + TRACK } },
              h('button', { type: 'button', onClick: () => { void run({ kind: 'read' }) }, style: buttonStyle }, copy.refresh),
              h('button', { type: 'button', onClick: () => { if (typeof close === 'function') close() }, style: buttonStyle }, copy.close)))
        }

        function SectionIcon({ size = 16, active = false }) {
          const color = active ? ACCENT : MUTED
          return h('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
            h('circle', { cx: 8, cy: 8, r: 6, fill: 'none', stroke: TRACK, strokeWidth: 2 }),
            h('circle', {
              cx: 8, cy: 8, r: 6, fill: 'none', stroke: color, strokeWidth: 2,
              strokeDasharray: '26 38', strokeLinecap: 'round', transform: 'rotate(-90 8 8)',
            }))
        }

        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
          { name: 'sidebar.footer.action', id: 'provider-quota-rings', order: 40 },
          QuotaFooter,
        ))
        ctx.slots.inject('settings.section', () => ctx.slots.register(
          { name: 'settings.section', id: 'provider-quota-rings', order: 60, label: () => copy.sectionLabel },
          QuotaSettings,
        ))
        ctx.slots.inject('settings.section.icon', () => ctx.slots.register(
          { name: 'settings.section.icon', id: 'provider-quota-rings' },
          SectionIcon,
        ))
      },
    }
  },
})
