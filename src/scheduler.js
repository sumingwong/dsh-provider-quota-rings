export const DEFAULT_INTERVAL_MS = 5 * 60 * 1000

export function createScheduler({
  intervalMs = DEFAULT_INTERVAL_MS,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onFire,
} = {}) {
  let timer = null
  let armedAt = 0
  let stopped = false
  let paused = false

  function clear() {
    if (timer != null) clearTimer(timer)
    timer = null
  }

  function arm() {
    if (stopped || paused || timer != null) return
    armedAt = now()
    timer = setTimer(() => {
      const firedAt = now()
      const late = firedAt - armedAt > intervalMs + 1000
      timer = null
      onFire?.({ late, firedAt, resume: false })
      arm()
    }, intervalMs)
  }

  return {
    start() { arm() },
    pause() {
      paused = true
      clear()
    },
    resume() {
      if (stopped || !paused) return
      paused = false
      onFire?.({ late: true, firedAt: now(), resume: true })
      arm()
    },
    dispose() {
      stopped = true
      paused = false
      clear()
    },
  }
}
