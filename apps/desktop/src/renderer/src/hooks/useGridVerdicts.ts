import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { GridVerdict } from '../../../shared/gridVerdict'

const WORKERS = 2

const known = new Map<string, GridVerdict | null>()
const listeners = new Set<() => void>()
let version = 0

function notify(): void {
  version += 1
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resetGridVerdicts(): void {
  known.clear()
  notify()
}

export interface GridVerdicts {
  verdictOf: (trackId: string) => GridVerdict | null | undefined
  done: number
  total: number
  measured: number
}

export function useGridVerdicts(entries: [string, string][], active: boolean): GridVerdicts {
  const seen = useSyncExternalStore(subscribe, () => version)
  useEffect(() => {
    if (!active) return
    let stopped = false
    const queue = entries.map(([, contentId]) => contentId).filter((id) => !known.has(id))
    const work = async (): Promise<void> => {
      for (;;) {
        const contentId = queue.shift()
        if (contentId === undefined || stopped) return
        const verdict = await window.api.rekordboxGridVerdict(contentId).catch(() => null)
        if (stopped) return
        known.set(contentId, verdict)
        notify()
      }
    }
    for (let i = 0; i < WORKERS; i++) void work()
    return () => {
      stopped = true
    }
  }, [entries, active])
  return useMemo(() => {
    const byTrack = new Map(entries)
    return {
      verdictOf: (trackId: string) => {
        const contentId = byTrack.get(trackId)
        return contentId === undefined ? undefined : known.get(contentId)
      },
      done: entries.filter(([, id]) => known.has(id)).length,
      total: entries.length,
      measured: seen,
    }
  }, [entries, seen])
}
