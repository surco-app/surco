import type { RowWaveRequest } from '../../../shared/types'

const BATCH_MS = 16

const known = new Map<string, number[] | null>()
const listeners = new Map<string, Set<() => void>>()
const inFlight = new Set<string>()
let queued = new Map<string, RowWaveRequest>()
let timer: ReturnType<typeof setTimeout> | null = null
// Files Surco measures itself because no library analysed them: each once per session.
const measuring = new Set<string>()

export function rowWaveKey(request: RowWaveRequest): string {
  return request.analysisPath ?? request.path
}

function settle(batch: RowWaveRequest[], found: Record<string, number[]>): void {
  for (const request of batch) {
    const key = rowWaveKey(request)
    inFlight.delete(key)
    known.set(key, found[key] ?? null)
    for (const listener of listeners.get(key) ?? []) listener()
    if (!found[key] && !request.analysisPath) measure(request)
  }
}

// A row with no library analysis only had a wave once its track was opened in Surco: the
// wave is measured in the background, behind anything the DJ is waiting for, and asked
// for again once it is in the cache. A library analysis that is missing is left to the
// row's own "not analysed" note.
function measure(request: RowWaveRequest): void {
  const key = rowWaveKey(request)
  if (measuring.has(key)) return
  measuring.add(key)
  Promise.resolve()
    .then(() => window.api.waveform(request.path, 'low'))
    .then((wave) => {
      if (!wave || !listeners.has(key)) return
      known.delete(key)
      queued.set(key, request)
      timer ??= setTimeout(flush, BATCH_MS)
    })
    .catch(() => {})
}

function flush(): void {
  timer = null
  const batch = [...queued.values()]
  queued = new Map()
  for (const request of batch) inFlight.add(rowWaveKey(request))
  Promise.resolve()
    .then(() => window.api.rowWaves(batch))
    .then(
      (found) => settle(batch, found),
      () => settle(batch, {}),
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
  measuring.clear()
  listeners.clear()
  inFlight.clear()
  queued = new Map()
}
