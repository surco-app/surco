import log from 'electron-log/main'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'

export interface WatchDeps {
  queue: Pick<RekordboxQueue, 'isEmpty' | 'apply'>
  collection: () => string
  isRunning: () => Promise<boolean>
  onApplied: (result: QueueApply) => void
  intervalMs?: number
  alwaysWatch?: () => boolean
  onClosed?: () => void
}

export function stillWaiting(result: QueueApply): boolean {
  return (
    result.status === 'refused' &&
    (result.reason === 'cancelled' || result.reason === 'rekordbox-running')
  )
}

export function watchRekordboxQueue(deps: WatchDeps): { poke: () => void; stop: () => void } {
  let timer: ReturnType<typeof setInterval> | null = null
  let armed = true
  let busy = false
  let seenRunning = false
  const shouldWatch = (): boolean => !deps.queue.isEmpty() || (deps.alwaysWatch?.() ?? false)

  const stop = (): void => {
    if (timer) clearInterval(timer)
    timer = null
    seenRunning = false
  }

  const tick = async (): Promise<void> => {
    if (busy) return
    if (!shouldWatch()) {
      stop()
      return
    }
    if (!deps.collection()) return
    busy = true
    try {
      let running: boolean
      try {
        running = await deps.isRunning()
      } catch (error) {
        log.warn('rekordbox queue watch could not check whether rekordbox runs', error)
        return
      }
      if (running) {
        armed = true
        seenRunning = true
        return
      }
      if (seenRunning) {
        seenRunning = false
        try {
          deps.onClosed?.()
        } catch (error) {
          log.warn('rekordbox close handler threw', error)
        }
      }
      if (deps.queue.isEmpty() || !armed) return
      let result: QueueApply
      try {
        result = await deps.queue.apply(async () => !(await deps.isRunning()))
      } catch (error) {
        log.warn('rekordbox queue apply threw', error)
        armed = false
        deps.onApplied({ status: 'refused', reason: 'write-failed' })
        return
      }
      if (stillWaiting(result)) return
      if (result.status === 'refused') armed = false
      if (result.status !== 'empty') deps.onApplied(result)
      if (!shouldWatch()) stop()
    } finally {
      busy = false
    }
  }

  return {
    poke() {
      if (!shouldWatch()) return
      if (!timer) timer = setInterval(() => void tick(), deps.intervalMs ?? 5000)
      void tick()
    },
    stop,
  }
}
