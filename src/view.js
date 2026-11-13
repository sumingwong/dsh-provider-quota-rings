const CIRCUMFERENCE = 87.96

function ringNode(h, ring, color) {
  const known = typeof ring.fraction === 'number' && Number.isFinite(ring.fraction)
  const percent = known ? Math.round(ring.fraction * 100) : null
  const dash = known ? `${(ring.fraction * CIRCUMFERENCE).toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}` : null
  return h('svg', {
    key: ring.key,
    viewBox: '0 0 36 36',
    width: 28,
    height: 28,
    'data-fraction': known ? String(ring.fraction) : 'unknown',
    'data-caption': ring.caption,
    role: 'img',
    'aria-label': known ? `${ring.caption} 剩余 ${percent}%` : `${ring.caption} 未知`,
  }, h('circle', {
    cx: 18, cy: 18, r: 14, fill: 'none', stroke: '#d9d3cb', strokeWidth: 3,
    strokeDasharray: known ? undefined : '2 3',
  }), known ? h('circle', {
    cx: 18, cy: 18, r: 14, fill: 'none', stroke: color, strokeWidth: 3,
    strokeDasharray: dash, strokeLinecap: 'round', transform: 'rotate(-90 18 18)',
  }) : null, h('text', {
    x: 18, y: 20, textAnchor: 'middle', fontSize: known ? 8 : 11, fill: '#1c1916',
  }, known ? String(percent) : '?'))
}

export const PROVIDER_COLORS = Object.freeze({
  codex: '#1f6b4a',
  claude: '#b35c2a',
  opencode: '#2a5f8a',
  grok: '#5c564e',
  glm: '#7a3e6d',
})

export function hoverCardElement(React, row) {
  const h = React.createElement
  const color = PROVIDER_COLORS[row.id] ?? '#1c1916'
  return h('div', {
    'data-hover-card': row.id,
    'data-example': row.status === 'example' ? '1' : '0',
    role: 'tooltip',
    style: {
      position: 'absolute',
      bottom: 'calc(100% - 8px)',
      left: 0,
      zIndex: 40,
      width: 260,
      maxWidth: '70vw',
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
  h('p', { 'data-status-text': '1', style: { margin: '6px 0', fontSize: 12 } }, row.statusText),
  (row.windows ?? []).map((window, index) => h('div', {
    key: `${row.id}-${index}`,
    'data-window': window.label,
    'data-scope': window.scope,
    style: { marginTop: 8 },
  }, h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 } },
    h('span', null, `${window.scopeText} · ${window.label}`),
    h('span', { 'data-remaining': window.remainingText }, window.remainingText)),
  h('span', {
    'data-remaining-bar': typeof window.fraction === 'number' ? String(window.fraction) : 'unknown',
    style: { display: 'block', height: 6, background: '#ece7e1', borderRadius: 99, overflow: 'hidden', margin: '4px 0' },
  }, typeof window.fraction === 'number' ? h('span', {
    style: { display: 'block', height: '100%', width: `${Math.round(window.fraction * 100)}%`, background: color },
  }) : null),
  h('div', { style: { fontSize: 12, color: '#5c564e' } }, `距重置 ${window.resetDistanceText}`),
  window.showQuantity ? h('div', { 'data-quantity': '1', style: { fontSize: 12 } }, `${window.quantityLabel || '数量'} ${window.quantityText}`) : null)),
  (row.windows ?? []).length === 0 ? h('p', null, '没有窗口。缺少的数量标为未知。') : null)
}

export function footerElement(React, { model, wide = true, onOpen, hoverId = null }) {
  const h = React.createElement
  return h('div', {
    'data-quota-rings': 'footer',
    'data-wide': wide ? '1' : '0',
    style: { display: 'flex', gap: 8, alignItems: 'end', justifyContent: 'space-between', padding: '4px 8px', overflow: 'visible' },
  }, (model?.rows ?? []).map((row) => h('div', {
    key: row.id,
    style: { position: 'relative' },
  }, hoverId === row.id ? h('div', {
    'data-hover-bridge': row.id,
    'aria-hidden': 'true',
    style: { position: 'absolute', left: 0, right: 0, bottom: '100%', height: 12 },
  }) : null, h('button', {
    type: 'button',
    'data-provider': row.id,
    'data-status': row.status,
    onClick: () => onOpen?.(row.id),
    style: { border: 0, background: 'transparent', color: PROVIDER_COLORS[row.id], padding: 0, cursor: 'pointer' },
  }, h('span', { style: { display: 'flex', gap: 2 } }, row.rings.map((ring, index) => ringNode(h, { ...ring, key: `${row.id}-${index}` }, PROVIDER_COLORS[row.id] ?? '#1c1916'))),
  wide ? h('span', { style: { display: 'block', fontSize: 10, color: '#1c1916' } }, row.label) : null),
  hoverId === row.id ? hoverCardElement(React, row) : null)))
}

export function dialogElement(React, { model, providerId, actions = {} }) {
  const h = React.createElement
  const row = model?.rows?.find((item) => item.id === providerId)
  if (!row) return null
  return h('dialog', {
    'data-quota-dialog': row.id,
    'aria-label': `${row.label} 额度`,
  }, h('header', null, h('strong', null, row.label), row.platformLabel ? h('span', null, ` ${row.platformLabel}`) : null),
  h('p', { 'data-status-text': '1' }, row.statusText),
  row.experimental ? h('p', null, '实验来源，可以单独停用。') : null,
  row.note ? h('p', null, row.note) : null,
  row.source ? h('p', null, row.source) : null,
  h('ul', null, row.windows.map((window, index) => h('li', { key: `${row.id}-${index}` },
    `${window.label} · ${window.scopeText} · 剩余 ${window.remainingText} · 重置 ${window.resetText} · ${window.quantityLabel || '数量'} ${window.quantityText}`))),
  row.windows.length === 0 ? h('p', null, '没有窗口。缺少的数量标为未知。') : null,
  row.link ? h('a', { href: row.link.href, target: '_blank', rel: 'noreferrer' }, row.link.label) : null,
  h('menu', null,
    h('button', { type: 'button', 'data-action': 'refresh', onClick: () => actions.refresh?.(row.id) }, '刷新'),
    h('button', { type: 'button', 'data-action': 'disable', onClick: () => actions.disable?.(row.id) }, row.status === 'disabled' ? '启用' : '停用'),
    row.id === 'glm' ? h('button', { type: 'button', 'data-action': 'platform-zhipu', onClick: () => actions.platform?.('zhipu') }, '智谱') : null,
    row.id === 'glm' ? h('button', { type: 'button', 'data-action': 'platform-zai', onClick: () => actions.platform?.('zai') }, 'Z.AI') : null,
    h('button', { type: 'button', 'data-action': 'close', onClick: () => actions.close?.() }, '关闭')),
  row.id === 'glm' ? h('form', {
    'data-glm-key': '1',
    onSubmit: (event) => {
      event.preventDefault?.()
      const field = event.target?.elements?.glmKey
      actions.store?.(String(field?.value ?? ''))
      event.target?.reset?.()
    },
  }, h('label', null, 'GLM 密钥（只进钥匙串，不要打在对话里）'),
  h('input', { name: 'glmKey', type: 'password', autoComplete: 'off', defaultValue: '' })) : null)
}
