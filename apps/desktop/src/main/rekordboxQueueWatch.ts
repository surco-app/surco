import type { QueueApply, RekordboxQueue } from './rekordboxQueue'

export interface WatchDeps {
  queue: Pick<RekordboxQueue, 'isEmpty' | 'apply'>
  collection: () => string
  isRunning: () => Promise<boolean>
  onApplied: (result: QueueApply) => void
  intervalMs?: number
}

export function watchRekordboxQueue(deps: WatchDeps): { poke: () => void; stop: () => void } {
  let timer: ReturnType<typeof setInterval> | null = null
  let armed = true
  let busy = false

  const stop = (): void => {
    if (timer) clearInterval(timer)
    timer = null
  }

  const tick = async (): Promise<void> => {
    if (busy) return
    if (deps.queue.isEmpty()) {
      stop()
      return
    }
    if (!deps.collection()) return
    busy = true
    try {
      if (await deps.isRunning()) {
        armed = true
        return
      }
      if (!armed) return
      const result = await deps.queue.apply(async () => !(await deps.isRunning()))
      if (
        result.status === 'refused' &&
        (result.reason === 'cancelled' || result.reason === 'rekordbox-running')
      )
        return
      if (result.status === 'refused') armed = false
      if (result.status !== 'empty') deps.onApplied(result)
      if (deps.queue.isEmpty()) stop()
    } finally {
      busy = false
    }
  }

  return {
    poke() {
      if (deps.queue.isEmpty()) return
      if (!timer) timer = setInterval(() => void tick(), deps.intervalMs ?? 5000)
      void tick()
    },
    stop,
  }
}
