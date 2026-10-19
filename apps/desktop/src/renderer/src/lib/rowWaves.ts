import type { RowWaveRequest } from '../../../shared/types'

const BATCH_MS = 16

const known = new Map<string, number[] | null>()
const listeners = new Map<string, Set<() => void>>()
const inFlight = new Set<string>()
let queued = new Map<string, RowWaveRequest>()
let timer: ReturnType<typeof setTimeout> | null = null

export function rowWaveKey(request: RowWaveRequest): string {
  return request.analysisPath ?? request.path
}

function settle(keys: string[], found: Record<string, number[]>): void {
  for (const key of keys) {
    inFlight.delete(key)
    known.set(key, found[key] ?? null)
    for (const listener of listeners.get(key) ?? []) listener()
  }
}

function flush(): void {
  timer = null
  const batch = [...queued.values()]
  queued = new Map()
  const keys = batch.map(rowWaveKey)
  for (const key of keys) inFlight.add(key)
  Promise.resolve()
    .then(() => window.api.rowWaves(batch))
    .then(
      (found) => settle(keys, found),
      () => settle(keys, {}),
    )
}

export function subscribeRowWave(request: RowWaveRequest, listener: () => void): () => void {
  const key = rowWaveKey(request)
  const set = listeners.get(key) ?? new Set<() => void>()
  set.add(listener)
  listeners.set(key, set)
  if (!known.has(key) && !inFlight.has(key) && !queued.has(key)) {
    queued.set(key, request)
    timer ??= setTimeout(flush, BATCH_MS)
  }
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(key)
  }
}

export function rowWaveOf(key: string): number[] | null | undefined {
  return known.get(key)
}

export function resetRowWaves(): void {
  if (timer) clearTimeout(timer)
  timer = null
  known.clear()
  listeners.clear()
  inFlight.clear()
  queued = new Map()
}
