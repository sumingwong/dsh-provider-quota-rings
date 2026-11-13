import fs from 'node:fs'
import path from 'node:path'
import { PROVIDERS } from './model.js'
import { isSecretKey } from './redact.js'

export function sanitizeSettings(input) {
  const source = input && typeof input === 'object' ? input : {}
  const disabled = {}
  if (source.disabled && typeof source.disabled === 'object') {
    for (const id of PROVIDERS) {
      if (source.disabled[id] === true) disabled[id] = true
    }
  }
  return {
    disabled,
    glmPlatform: source.glmPlatform === 'zai' ? 'zai' : 'zhipu',
    liveReads: source.liveReads === true,
    glmKeyStored: source.glmKeyStored === true,
    opencodeKeyStored: source.opencodeKeyStored === true,
  }
}

function forbidden(value) {
  if (!value || typeof value !== 'object') return false
  for (const [key, item] of Object.entries(value)) {
    if (isSecretKey(key)) return true
    if (forbidden(item)) return true
  }
  return false
}

export function createSettingsStore(dir) {
  const file = path.join(dir, 'settings.json')
  let current = sanitizeSettings({})

  function write(next) {
    current = next
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 })
    return current
  }

  function load() {
    let parsed = null
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      current = sanitizeSettings({})
      return current
    }
    const clean = sanitizeSettings(parsed)
    current = clean
    if (forbidden(parsed)) write(clean)
    return current
  }

  load()
  return {
    file,
    get() { return current },
    save(patch = {}) {
      const patchObject = patch && typeof patch === 'object' ? patch : {}
      return write(sanitizeSettings({
        disabled: patchObject.disabled ?? current.disabled,
        glmPlatform: patchObject.glmPlatform ?? current.glmPlatform,
        liveReads: Object.hasOwn(patchObject, 'liveReads') ? patchObject.liveReads : current.liveReads,
        glmKeyStored: Object.hasOwn(patchObject, 'glmKeyStored') ? patchObject.glmKeyStored : current.glmKeyStored,
        opencodeKeyStored: Object.hasOwn(patchObject, 'opencodeKeyStored') ? patchObject.opencodeKeyStored : current.opencodeKeyStored,
      }))
    },
  }
}
