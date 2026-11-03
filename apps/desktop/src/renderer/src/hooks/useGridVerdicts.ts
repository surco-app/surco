import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { GridVerdict } from '../../../shared/gridVerdict'

const WORKERS = 2

const known = new Map<string, GridVerdict | null>()
const pending = new Set<string>()
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
  pending.clear()
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
  const ids = useMemo(() => entries.map(([, contentId]) => contentId).join('\n'), [entries])
  const latest = useRef(entries)
  latest.current = entries
  useEffect(() => {
    if (!active || ids === '') return
    let stopped = false
    const next = (): string | undefined =>
      latest.current
        .map(([, contentId]) => contentId)
        .find((id) => !known.has(id) && !pending.has(id))
    const work = async (): Promise<void> => {
      for (;;) {
        if (stopped) return
        const contentId = next()
        if (contentId === undefined) return
        pending.add(contentId)
        const verdict = await window.api.rekordboxGridVerdict(contentId).catch(() => null)
        pending.delete(contentId)
        known.set(contentId, verdict)
        notify()
      }
    }
    for (let i = 0; i < WORKERS; i++) void work()
    return () => {
      stopped = true
    }
  }, [ids, active])
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
