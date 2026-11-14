import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { GridCheck } from '../../../shared/gridAudit'
import { type EditableGrid, editableGridOf, gridBeats } from '../../../shared/gridEdit'
import type { QueuedCues, TrackCueRow } from '../../../shared/types'
import { appliedGrid } from '../lib/appliedGrid'
import { cueProgramOf } from '../lib/cuePrograms'
import { keptOnSurcoGrid, subscribeCueDrafts } from '../lib/cueSession'
import { auditCheckOf, beatsKey } from '../lib/gridAuditCheck'
import { gridGate } from '../lib/gridGate'
import { queuedCuesQuery, trackCuesQuery } from './useTrackCues'

const WORKERS = 2

interface GridRead {
  analysed: boolean
  clockLeadMs?: number | null
  durationMs: number
  fingerprint: string
  gridFingerprint: string
  cues: TrackCueRow[]
  programGrid: EditableGrid | null
  kicks: number[]
}

const reads = new Map<string, GridRead | null>()
const queues = new Map<string, QueuedCues | null>()
const checks = new Map<string, GridCheck | null>()
const auditing = new Set<string>()
const pending = new Set<string>()
const stale: string[] = []
let draining = false
const listeners = new Set<() => void>()
let checker = (contentId: string): GridCheck | null | undefined => checkOfContent(contentId)

function notify(): void {
  checker = (contentId) => checkOfContent(contentId)
  for (const listener of listeners) listener()
}

// A measure is told at once after a quiet spell, and a burst of them at most once a second:
// every notice re-renders the App and recounts the filters over the whole list, and with
// every import analysed a big collection measured, and re-rendered, 130 times a second.
const MEASURE_NOTICE_MS = 1000
let lastMeasureNotice = Number.NEGATIVE_INFINITY
let measureNoticeTimer: ReturnType<typeof setTimeout> | null = null

function noticeMeasured(): void {
  if (measureNoticeTimer) return
  const tell = (): void => {
    measureNoticeTimer = null
    lastMeasureNotice = performance.now()
    notify()
  }
  const wait = lastMeasureNotice + MEASURE_NOTICE_MS - performance.now()
  if (wait <= 0) tell()
  else measureNoticeTimer = setTimeout(tell, wait)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resetGridChecks(): void {
  if (measureNoticeTimer) clearTimeout(measureNoticeTimer)
  measureNoticeTimer = null
  lastMeasureNotice = Number.NEGATIVE_INFINITY
  reads.clear()
  queues.clear()
  checks.clear()
  auditing.clear()
  pending.clear()
  stale.length = 0
  notify()
}

function auditedBeats(contentId: string, read: GridRead): { beats: number[]; key: string } | null {
  if (!read.analysed || cueProgramOf(contentId).fixedGrid) return null
  const { grid, changed } = appliedGrid(
    contentId,
    read,
    queues.get(contentId) ?? null,
    read.programGrid,
  )
  const gate = gridGate({ contentId, read, grid, onSurcoGrid: keptOnSurcoGrid(contentId) })
  if (gate !== null || grid === null) return null
  const beats = changed ? gridBeats(grid, read.durationMs).map((b) => b.ms) : read.kicks
  return { beats, key: `${contentId}|${beatsKey(beats)}` }
}

async function audit(contentId: string, beats: number[], key: string): Promise<void> {
  if (checks.has(key) || auditing.has(key)) return
  auditing.add(key)
  checks.set(key, await auditCheckOf(contentId, beats, 'low'))
  auditing.delete(key)
}

function checkOfContent(contentId: string): GridCheck | null | undefined {
  const read = reads.get(contentId)
  if (read === undefined) return undefined
  if (!read) return null
  const audited = auditedBeats(contentId, read)
  if (!audited) return null
  const check = checks.get(audited.key)
  if (check === undefined) void audit(contentId, audited.beats, audited.key).then(noticeMeasured)
  return check
}

const gridReadQuery = (contentId: string) => ({
  queryKey: [...trackCuesQuery(contentId).queryKey, 'grid'],
  queryFn: async (): Promise<GridRead | null> => {
    const read = await window.api.cues.trackCues(contentId)
    return (
      read && {
        analysed: read.analysed,
        clockLeadMs: read.clockLeadMs,
        durationMs: read.durationMs,
        fingerprint: read.fingerprint,
        gridFingerprint: read.gridFingerprint,
        cues: read.cues,
        programGrid: editableGridOf(read.grid),
        kicks: read.grid.map((b) => b.ms),
      }
    )
  },
  staleTime: Number.POSITIVE_INFINITY,
})

async function measure(client: QueryClient, contentId: string): Promise<void> {
  const read = await client.fetchQuery(gridReadQuery(contentId)).catch(() => null)
  const queued = read ? await client.fetchQuery(queuedCuesQuery(contentId)) : null
  queues.set(contentId, queued)
  const audited = read && auditedBeats(contentId, read)
  if (audited) await audit(contentId, audited.beats, audited.key)
  reads.set(contentId, read)
  noticeMeasured()
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
}

export function useGridChecks(entries: [string, string][], active: boolean): GridChecks {
  const client = useQueryClient()
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
    let from = 0
    const next = (): string | undefined => {
      const list = latest.current
      for (; from < list.length; from++) {
        const [, contentId] = list[from]
        if (!reads.has(contentId) && !pending.has(contentId)) return contentId
      }
      return undefined
    }
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
    }
  }, [entries, checkContent])
}
