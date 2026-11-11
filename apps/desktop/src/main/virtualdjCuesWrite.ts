import log from 'electron-log/main'
import { HOT_KINDS, validWantedSet, type WantedCue } from '../shared/cueRules'
import { hotCueArgb, nearestHotCueColor } from '../shared/rekordboxCueColors'
import type { RekordboxQueueNotice } from '../shared/types'
import { virtualdjFileOf } from '../shared/virtualdjContent'
import { cueFingerprint } from './rekordboxCues'
import type { BatchResult, OpOutcome, QueueOp } from './rekordboxQueueOps'
import { virtualdjCueRows } from './virtualdjCueSource'
import { parseVirtualdjDatabase, type VirtualdjPoi, type VirtualdjSong } from './virtualdjDatabase'
import { type VirtualdjCueWrite, withVirtualdjCues } from './virtualdjDatabaseWrite'
import { type VirtualdjRoot, virtualdjPathOf } from './virtualdjLibrary'
import {
  applyVirtualdjDraftOps,
  type VirtualdjCommitDeps,
  type VirtualdjDraft,
  virtualdjDatabaseOf,
} from './virtualdjLibraryWrite'

function colorOf(wanted: WantedCue, before: VirtualdjPoi | undefined): number | undefined {
  if (wanted.color === null) return undefined
  if (before?.color !== undefined && nearestHotCueColor(before.color) === wanted.color)
    return before.color
  return hotCueArgb(wanted.color)
}

function cueOf(wanted: WantedCue, song: VirtualdjSong): VirtualdjCueWrite {
  const before = song.pois.find((p) => p.kind === 'cue' && String(p.num) === wanted.id)
  const name = before?.name
  const color = colorOf(wanted, before)
  return {
    num: HOT_KINDS.indexOf(wanted.kind) + 1,
    seconds: before && before.seconds * 1000 === wanted.ms ? before.seconds : wanted.ms / 1000,
    ...(name && { name }),
    ...(color !== undefined && { color }),
  }
}

const cueKeys = (cues: { slot: number; ms: number; color: number | null }[]): string =>
  cues
    .map((c) => `${c.slot}|${Math.round(c.ms)}|${c.color ?? ''}`)
    .sort()
    .join(';')

function holdsWanted(rows: ReturnType<typeof virtualdjCueRows>, wanted: WantedCue[]): boolean {
  return (
    cueKeys(rows.map((r) => ({ slot: Number(r.id), ms: r.ms, color: r.color }))) ===
    cueKeys(
      wanted
        .filter((c) => c.kind !== 0)
        .map((c) => ({ slot: HOT_KINDS.indexOf(c.kind) + 1, ms: c.ms, color: c.color })),
    )
  )
}

export function songIn(
  draft: VirtualdjDraft,
  roots: VirtualdjRoot[],
  path: string,
): { root: VirtualdjRoot; file: string; xml: string; song: VirtualdjSong } | null {
  const wanted = path.normalize('NFC')
  for (const root of roots) {
    const file = virtualdjDatabaseOf(root)
    const xml = draft.read(file)
    const song =
      xml &&
      parseVirtualdjDatabase(xml).find(
        (s) => virtualdjPathOf(root, s.path).normalize('NFC') === wanted,
      )
    if (xml && song) return { root, file, xml, song }
  }
  return null
}

export function applyVirtualdjCueOp(
  draft: VirtualdjDraft,
  op: QueueOp,
  roots: VirtualdjRoot[],
): OpOutcome {
  const refused = (
    code: 'cues-changed' | 'cues-invalid' | 'cues-write-failed' | 'not-in-library',
  ): OpOutcome => ({
    id: op.id,
    applied: false,
    notices: [{ code, track: op.kind === 'edit' ? '' : op.label }],
  })
  if (op.kind !== 'cues' || op.wanted === undefined || op.grid) return refused('cues-invalid')
  const found = songIn(draft, roots, virtualdjFileOf(op.contentId))
  if (!found) return refused('not-in-library')
  const { file, xml, song } = found
  const rows = virtualdjCueRows(song)
  const calls = op.wanted.filter((c) => c.kind === 0).map((c) => c.ms)
  const notices: RekordboxQueueNotice[] =
    calls.length > 0 ? [{ code: 'cues-calls-dropped', track: op.label, calls }] : []
  if (cueFingerprint(rows) !== op.fingerprint)
    return holdsWanted(rows, op.wanted)
      ? { id: op.id, applied: true, notices }
      : refused('cues-changed')
  const valid = validWantedSet(op.wanted, rows)
  if (!valid.ok) {
    log.warn(`VirtualDJ cues: refused the queued set for ${op.contentId} (${valid.reason})`)
    return refused('cues-invalid')
  }
  const cues = op.wanted.filter((c) => c.kind !== 0).map((c) => cueOf(c, song))
  const next = withVirtualdjCues(xml, song.path, cues)
  if (next === null) return refused('cues-write-failed')
  draft.write(file, next)
  return { id: op.id, applied: true, notices }
}

export function applyVirtualdjCuesBatch(
  ops: QueueOp[],
  deps: VirtualdjCommitDeps & {
    ensureClosed: () => Promise<boolean>
    stillQueued?: (id: string) => boolean
  },
): Promise<BatchResult> {
  return applyVirtualdjDraftOps(ops, deps, applyVirtualdjCueOp)
}
