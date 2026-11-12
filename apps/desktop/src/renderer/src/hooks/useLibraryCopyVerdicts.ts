import { isCancelledError, type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { type AppleMusicIndex, replaceCandidate } from '../lib/appleMusicLibrary'
import { type CopyFacts, type CopyVerdict, compareCopies } from '../lib/bestCopy'
import type { TrackItem } from '../types'
import { copyFactsQueries, pairOptions, toCopyFacts } from './useCopyFacts'

const WORKERS = 2

const known = new Map<string, CopyVerdict | null>()
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

export function resetLibraryCopyVerdicts(): void {
  known.clear()
  pending.clear()
  notify()
}

interface Entry {
  trackId: string
  inputPath: string
  persistentId: string
  key: string
}

const samePath = (a: string, b: string): boolean =>
  a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase()

async function factsOf(client: QueryClient, path: string): Promise<CopyFacts | null> {
  const [spectrumQuery, loudQuery, fpQuery] = copyFactsQueries(path)
  const [spectrum, loud, fingerprint] = await Promise.all([
    client.fetchQuery(spectrumQuery),
    client.fetchQuery(loudQuery),
    client.fetchQuery(fpQuery),
  ])
  return toCopyFacts(path, spectrum, loud, fingerprint)
}

async function measure(client: QueryClient, entry: Entry): Promise<CopyVerdict | null> {
  const libraryPath = await window.api.appleMusicEntryLocation(entry.persistentId)
  if (!libraryPath || samePath(libraryPath, entry.inputPath)) return null
  const [here, library, pair] = await Promise.all([
    factsOf(client, entry.inputPath),
    factsOf(client, libraryPath),
    client.fetchQuery(pairOptions(entry.inputPath, libraryPath)),
  ])
  return here && library ? compareCopies(here, library, pair) : null
}

const entryCache = new WeakMap<AppleMusicIndex, WeakMap<TrackItem, Entry | null>>()

function entryOf(index: AppleMusicIndex, t: TrackItem): Entry | null {
  let byTrack = entryCache.get(index)
  if (!byTrack) {
    byTrack = new WeakMap()
    entryCache.set(index, byTrack)
  }
  const cached = byTrack.get(t)
  if (cached !== undefined) return cached
  const copy = replaceCandidate(index, {
    title: t.meta.title,
    artist: t.meta.artist,
    durationSec: t.duration,
  })
  const entry =
    !copy || 'ambiguous' in copy
      ? null
      : {
          trackId: t.id,
          inputPath: t.inputPath,
          persistentId: copy.persistentId,
          key: `${t.inputPath}\0${copy.persistentId}`,
        }
  byTrack.set(t, entry)
  return entry
}

function entriesOf(tracks: TrackItem[], index: AppleMusicIndex | null): Entry[] {
  if (!index) return []
  const entries: Entry[] = []
  for (const t of tracks) {
    if (t.inLibrary !== true || t.musicPersistentId) continue
    const entry = entryOf(index, t)
    if (entry) entries.push(entry)
  }
  return entries
}

const sameEntries = (a: Entry[], b: Entry[]): boolean =>
  a.length === b.length && a.every((e, i) => e.trackId === b[i].trackId && e.key === b[i].key)

export interface LibraryCopyVerdicts {
  verdictOf: (track: TrackItem) => CopyVerdict | null | undefined
  done: number
  total: number
}

export function useLibraryCopyVerdicts(
  tracks: TrackItem[],
  index: AppleMusicIndex | null,
  active: boolean,
): LibraryCopyVerdicts {
  const client = useQueryClient()
  const seen = useSyncExternalStore(subscribe, () => version)
  const prevEntries = useRef<Entry[]>([])
  const entries = useMemo(() => {
    const next = entriesOf(tracks, index)
    if (!sameEntries(prevEntries.current, next)) prevEntries.current = next
    return prevEntries.current
  }, [tracks, index])
  const keys = useMemo(() => entries.map((e) => e.key).join('\n'), [entries])
  const latest = useRef(entries)
  latest.current = entries
  useEffect(() => {
    if (!active || keys === '') return
    let stopped = false
    const next = (): Entry | undefined =>
      latest.current.find((e) => !known.has(e.key) && !pending.has(e.key))
    const work = async (): Promise<void> => {
      for (;;) {
        if (stopped) return
        const entry = next()
        if (entry === undefined) return
        pending.add(entry.key)
        const verdict = await measure(client, entry).catch((err) =>
          isCancelledError(err) ? undefined : null,
        )
        pending.delete(entry.key)
        if (verdict !== undefined) known.set(entry.key, verdict)
        notify()
      }
    }
    for (let i = 0; i < WORKERS; i++) void work()
    return () => {
      stopped = true
    }
  }, [keys, active, client])
  // biome-ignore lint/correctness/useExhaustiveDependencies: seen is the store's version, listed so a verdict landing rebuilds the lookup.
  return useMemo(() => {
    const keyOf = new Map(entries.map((e) => [e.trackId, e.key]))
    return {
      verdictOf: (track: TrackItem) => {
        const key = keyOf.get(track.id)
        return key === undefined ? undefined : known.get(key)
      },
      done: entries.filter((e) => known.has(e.key)).length,
      total: entries.length,
    }
  }, [entries, seen])
}
