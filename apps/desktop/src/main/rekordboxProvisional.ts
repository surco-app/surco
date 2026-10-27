import type Database from 'better-sqlite3-multiple-ciphers'
import log from 'electron-log/main'
import type { WantedCue } from '../shared/cueRules'
import { nearestBeat } from '../shared/cueRules'
import type { RekordboxQueueNotice, TrackCueRow } from '../shared/types'
import { rekordboxShareDir } from './rekordboxArtwork'
import { readTrackCues } from './rekordboxCues'
import { withCollection } from './rekordboxPlaylistsIpc'
import type { QueueStore, RekordboxQueue } from './rekordboxQueue'
import type { CuesOp } from './rekordboxQueueOps'

type Db = InstanceType<typeof Database>

const FIT_SHARE_OF_BEAT = 0.25

export interface ProvisionalEntry {
  contentId: string
  label: string
  wanted: WantedCue[]
}

export interface ProvisionalList {
  add: (entry: ProvisionalEntry) => void
  all: () => ProvisionalEntry[]
  settle: (contentIds: string[]) => void
}

export function createProvisionalList(
  store: QueueStore,
  onWaiting: () => void = () => {},
): ProvisionalList {
  let entries: ProvisionalEntry[] = []
  try {
    const text = store.read()
    if (text) entries = (JSON.parse(text) as { entries: ProvisionalEntry[] }).entries
  } catch (err) {
    log.warn(`rekordbox provisional list unreadable, starting empty: ${String(err)}`)
    entries = []
  }
  const save = () => store.write(JSON.stringify({ version: 1, entries }))
  return {
    add(entry) {
      entries = [...entries.filter((e) => e.contentId !== entry.contentId), entry]
      save()
      onWaiting()
    },
    all: () => entries,
    settle(contentIds) {
      if (contentIds.length === 0) return
      entries = entries.filter((e) => !contentIds.includes(e.contentId))
      save()
    },
  }
}

export function onRekordboxGrid(
  cues: TrackCueRow[],
  beats: number[],
): { wanted: WantedCue[]; moved: number; maxMs: number; unfit: number; unfitMs: number } {
  let moved = 0
  let maxMs = 0
  let unfit = 0
  let unfitMs = Number.POSITIVE_INFINITY
  const wanted = cues.map((c) => {
    const keep = { id: c.id, ms: c.ms, kind: c.kind, color: c.color }
    if (c.loop) return keep
    const at = nearestBeat(beats, c.ms)
    const beat = beats[at]
    const period = Math.abs((beats[at + 1] ?? beats[at - 1]) - beat)
    const off = Math.abs(beat - c.ms)
    if (off === 0) return keep
    if (off > period * FIT_SHARE_OF_BEAT) {
      unfit++
      unfitMs = Math.min(unfitMs, c.ms)
      return keep
    }
    moved++
    maxMs = Math.max(maxMs, off)
    return { ...keep, ms: beat }
  })
  return { wanted, moved, maxMs, unfit, unfitMs }
}

const cueKey = (c: { ms: number; kind: number; color: number | null }) =>
  `${c.ms}|${c.kind}|${c.color ?? ''}`

const sameSet = (a: { ms: number; kind: number; color: number | null }[], b: typeof a) =>
  a.map(cueKey).sort().join(';') === b.map(cueKey).sort().join(';')

export function adjustmentOps(
  db: Db,
  shareDir: string,
  entries: ProvisionalEntry[],
  newId: () => string,
): { ops: CuesOp[]; settled: string[] } {
  const ops: CuesOp[] = []
  const settled: string[] = []
  const folder = db.prepare(
    'SELECT FolderPath FROM djmdContent WHERE ID = ? AND coalesce(rb_local_deleted, 0) = 0',
  )
  for (const entry of entries) {
    const read = readTrackCues(db, shareDir, entry.contentId, { wave: false })
    const path = (folder.get(entry.contentId) as { FolderPath: string } | undefined)?.FolderPath
    if (!read || !path) {
      settled.push(entry.contentId)
      continue
    }
    if (!read.analysed) continue
    settled.push(entry.contentId)
    if (!sameSet(read.cues, entry.wanted)) continue
    const fit = onRekordboxGrid(
      read.cues,
      read.grid.map((b) => b.ms),
    )
    const notices: RekordboxQueueNotice[] = []
    if (fit.moved > 0)
      notices.push({
        code: 'cues-adjusted',
        track: entry.label,
        moved: fit.moved,
        maxMs: fit.maxMs,
      })
    if (fit.unfit > 0)
      notices.push({
        code: 'cues-unfit',
        track: entry.label,
        count: fit.unfit,
        contentId: entry.contentId,
        ms: fit.unfitMs,
      })
    if (notices.length === 0) continue
    ops.push({
      id: newId(),
      kind: 'cues',
      contentId: entry.contentId,
      path,
      label: entry.label,
      wanted: fit.wanted,
      fingerprint: read.fingerprint,
      notices,
    })
  }
  return { ops, settled }
}

export function adjustProvisional(deps: {
  list: ProvisionalList
  collection: () => string
  queue: Pick<RekordboxQueue, 'enqueue' | 'cuesOp' | 'state'>
  newId: () => string
  // The tracks the DJ holds unsaved cues for in Surco: moving the cues under the draft would
  // throw it away, so they keep waiting.
  unsaved?: () => ReadonlySet<string>
}): void {
  const state = deps.queue.state()
  if (state.halted) return
  const entries = deps.list
    .all()
    .filter((e) => !deps.queue.cuesOp(e.contentId) && !deps.unsaved?.().has(e.contentId))
  const path = deps.collection()
  if (entries.length === 0 || !path) return
  try {
    const { ops, settled } = withCollection(
      path,
      (db) => adjustmentOps(db, rekordboxShareDir(path), entries, deps.newId),
      { ops: [], settled: [] },
    )
    if (ops.length > 0) deps.queue.enqueue(ops)
    deps.list.settle(settled)
  } catch (err) {
    log.warn(`rekordbox provisional adjustment skipped: ${String(err)}`)
  }
}
