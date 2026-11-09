import { useCallback, useMemo, useRef, useState } from 'react'
import type { DjProgram } from '../../../shared/djProgram'
import type { SourcePlaylistEntry } from '../../../shared/types'
import { SOURCE_READ } from '../lib/sourcePrograms'

type Rows = readonly SourcePlaylistEntry[]

export interface SessionRows {
  load(ids: readonly string[]): Promise<ReadonlyMap<string, Rows>>
  reset(): void
  loading: boolean
  failed: readonly string[]
}

export function useSessionRows(program: DjProgram): SessionRows {
  const cache = useRef(new Map<string, Promise<Rows | null>>())
  const [inFlight, setInFlight] = useState(0)
  const [failedKeys, setFailedKeys] = useState<string[]>([])
  const prefix = `${program}:`

  const read = useCallback(
    (id: string): Promise<Rows | null> => {
      const key = `${prefix}${id}`
      const known = cache.current.get(key)
      if (known) return known
      const started = SOURCE_READ[program].playlist(id).then(
        (rows) => {
          setFailedKeys((list) => (list.includes(key) ? list.filter((k) => k !== key) : list))
          return rows
        },
        () => {
          cache.current.delete(key)
          setFailedKeys((list) => (list.includes(key) ? list : [...list, key]))
          return null
        },
      )
      cache.current.set(key, started)
      return started
    },
    [program, prefix],
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

  const reset = useCallback(() => {
    cache.current = new Map()
    setFailedKeys([])
  }, [])

  const failed = useMemo(
    () => failedKeys.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)),
    [failedKeys, prefix],
  )

  return { load, reset, loading: inFlight > 0, failed }
}
