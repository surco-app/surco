import { useCallback, useEffect, useRef, useState } from 'react'
import type { DjProgram } from '../../../shared/djProgram'
import type { SourcePlaylistEntry } from '../../../shared/types'
import { SOURCE_READ } from '../lib/sourcePrograms'

type Rows = readonly SourcePlaylistEntry[]

export interface SessionRows {
  load(ids: readonly string[]): Promise<ReadonlyMap<string, Rows>>
  loading: boolean
  failed: readonly string[]
}

export function useSessionRows(program: DjProgram): SessionRows {
  const cache = useRef(new Map<string, Promise<Rows | null>>())
  const [inFlight, setInFlight] = useState(0)
  const [failed, setFailed] = useState<string[]>([])

  useEffect(() => {
    cache.current = new Map()
    setFailed([])
  }, [program])

  const read = useCallback(
    (id: string): Promise<Rows | null> => {
      const known = cache.current.get(id)
      if (known) return known
      const started = SOURCE_READ[program].playlist(id).then(
        (rows) => rows,
        () => {
          cache.current.delete(id)
          setFailed((list) => (list.includes(id) ? list : [...list, id]))
          return null
        },
      )
      cache.current.set(id, started)
      return started
    },
    [program],
  )

  const load = useCallback(
    async (ids: readonly string[]): Promise<ReadonlyMap<string, Rows>> => {
      setInFlight((n) => n + 1)
      try {
        const results = await Promise.all(ids.map(async (id) => [id, await read(id)] as const))
        const loaded = new Map<string, Rows>()
        for (const [id, rows] of results) if (rows) loaded.set(id, rows)
        return loaded
      } finally {
        setInFlight((n) => n - 1)
      }
    },
    [read],
  )

  return { load, loading: inFlight > 0, failed }
}
