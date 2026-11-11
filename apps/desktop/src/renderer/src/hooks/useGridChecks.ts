import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { checkGrid, type GridCheck } from '../../../shared/gridCheck'
import {
  type EditableGrid,
  editableGridOf,
  type GridFit,
  gridBeats,
} from '../../../shared/gridEdit'
import type { QueuedCues, TrackCues } from '../../../shared/types'
import { appliedGrid } from '../lib/appliedGrid'
import { cueProgramOf } from '../lib/cuePrograms'
import { keptOnSurcoGrid, subscribeCueDrafts } from '../lib/cueSession'
import { gridGate } from '../lib/gridGate'
import { gridFitQuery, queuedCuesQuery, trackCuesQuery } from './useTrackCues'

const WORKERS = 2

interface Memo {
  programGrid: EditableGrid | null
  fit?: GridFit
  grid?: EditableGrid
  check?: GridCheck
}

const reads = new Map<string, TrackCues | null>()
const fits = new Map<string, GridFit | null>()
const queues = new Map<string, QueuedCues | null>()
const memos = new WeakMap<TrackCues, Memo>()
const pending = new Set<string>()
const stale: string[] = []
let draining = false
const listeners = new Set<() => void>()
let version = 0
let checker = (contentId: string): GridCheck | null | undefined => checkOfContent(contentId)

function notify(): void {
  version += 1
  checker = (contentId) => checkOfContent(contentId)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resetGridChecks(): void {
  reads.clear()
  fits.clear()
  queues.clear()
  pending.clear()
  stale.length = 0
  notify()
}

function memoOf(read: TrackCues): Memo {
  const kept = memos.get(read)
  if (kept) return kept
  const memo: Memo = { programGrid: editableGridOf(read.grid) }
  memos.set(read, memo)
  return memo
}

function checkOfContent(contentId: string): GridCheck | null | undefined {
  const read = reads.get(contentId)
  if (read === undefined) return undefined
  const fit = fits.get(contentId)
  if (!read || !fit) return null
  const memo = memoOf(read)
  const { grid, changed } = appliedGrid(
    contentId,
    read,
    queues.get(contentId) ?? null,
    memo.programGrid,
  )
  const gate = gridGate({ contentId, read, grid, onSurcoGrid: keptOnSurcoGrid(contentId) })
  if (gate !== null || grid === null) return null
  if (memo.check && memo.fit === fit && memo.grid === grid) return memo.check
  const beats = changed ? gridBeats(grid, read.durationMs) : read.grid
  const check = checkGrid({
    beats: beats.map((b) => b.ms),
    kicks: read.grid.map((b) => b.ms),
    fit,
    atMs: 0,
    durationMs: read.durationMs,
  })
  Object.assign(memo, { fit, grid, check })
  return check
}

async function measure(client: QueryClient, contentId: string): Promise<void> {
  const read = await client.fetchQuery(trackCuesQuery(contentId)).catch(() => null)
  const queued = read ? await client.fetchQuery(queuedCuesQuery(contentId)) : null
  if (read?.analysed && !cueProgramOf(contentId).fixedGrid && !fits.has(contentId))
    fits.set(
      contentId,
      await client
        .fetchQuery({
          ...gridFitQuery(contentId),
          queryFn: () => window.api.cues.gridFit(contentId, 'low'),
        })
        .catch(() => null),
    )
  queues.set(contentId, queued)
  reads.set(contentId, read)
  notify()
}

async function remeasure(client: QueryClient, contentId: string): Promise<void> {
  if (stale.includes(contentId)) return
  stale.push(contentId)
  if (draining) return
  draining = true
  for (let next = stale[0]; next !== undefined; next = stale[0]) {
    await measure(client, next)
    stale.shift()
  }
  draining = false
}

export interface GridChecks {
  checkOf: (trackId: string) => GridCheck | null | undefined
  checkOfContent: (contentId: string) => GridCheck | null | undefined
  done: number
  total: number
  measured: number
}

export function useGridChecks(entries: [string, string][], active: boolean): GridChecks {
  const client = useQueryClient()
  const seen = useSyncExternalStore(subscribe, () => version)
  const checkContent = useSyncExternalStore(subscribe, () => checker)
  const ids = useMemo(() => entries.map(([, contentId]) => contentId).join('\n'), [entries])
  const latest = useRef(entries)
  latest.current = entries
  useEffect(() => subscribeCueDrafts(notify), [])
  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        const [kind, contentId] = event.query.queryKey
        if (event.type !== 'updated' || event.action.type !== 'invalidate') return
        const watched = [trackCuesQuery('').queryKey[0], queuedCuesQuery('').queryKey[0]]
        if (!watched.includes(String(kind)) || typeof contentId !== 'string') return
        if (reads.has(contentId)) void remeasure(client, contentId)
      }),
    [client],
  )
  useEffect(() => {
    if (!active || ids === '') return
    let stopped = false
    const next = (): string | undefined =>
      latest.current
        .map(([, contentId]) => contentId)
        .find((id) => !reads.has(id) && !pending.has(id))
    const work = async (): Promise<void> => {
      for (;;) {
        if (stopped) return
        const contentId = next()
        if (contentId === undefined) return
        pending.add(contentId)
        await measure(client, contentId)
        pending.delete(contentId)
      }
    }
    for (let i = 0; i < WORKERS; i++) void work()
    return () => {
      stopped = true
    }
  }, [ids, active, client])
  return useMemo(() => {
    const byTrack = new Map(entries)
    return {
      checkOf: (trackId: string) => {
        const contentId = byTrack.get(trackId)
        return contentId === undefined ? undefined : checkOfContent(contentId)
      },
      checkOfContent: checkContent,
      done: entries.filter(([, id]) => reads.has(id)).length,
      total: entries.length,
      measured: seen,
    }
  }, [entries, seen, checkContent])
}
