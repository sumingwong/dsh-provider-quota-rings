/** Bind an injected power monitor. A unit test of this function is not a desktop wake. */
export function bindPowerMonitor(monitor, service) {
  if (!monitor || typeof monitor.on !== 'function' || !service) return () => {}
  const suspend = () => service.pause()
  const resume = () => service.resume()
  monitor.on('suspend', suspend)
  monitor.on('resume', resume)
  return () => {
    if (typeof monitor.removeListener === 'function') {
      monitor.removeListener('suspend', suspend)
      monitor.removeListener('resume', resume)
    } else if (typeof monitor.off === 'function') {
      monitor.off('suspend', suspend)
      monitor.off('resume', resume)
    }
  }
}

/**
 * Subscribe to a host `dsh/power` event when the context has `on`.
 * The installed 0.2.2-rc.2 shell does not emit this yet. Binding is not a real wake.
 */
export function bindHostPower(ctx, service) {
  if (!ctx || typeof ctx.on !== 'function' || !service) return () => {}
  const onPower = (phase) => {
    if (phase === 'suspend') service.pause()
    else if (phase === 'resume') service.resume()
  }
  const dispose = ctx.on('dsh/power', onPower)
  return () => {
    if (typeof dispose === 'function') dispose()
    else if (typeof ctx.off === 'function') ctx.off('dsh/power', onPower)
  }
}
