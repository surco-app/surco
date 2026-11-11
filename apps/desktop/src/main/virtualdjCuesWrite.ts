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
import {
  commitVirtualdjDraft,
  createVirtualdjDraft,
  type VirtualdjCommitDeps,
  type VirtualdjDraft,
  virtualdjDatabaseOf,
} from './virtualdjLibraryWrite'

const ATTEMPTS = 3

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

function songIn(
  draft: VirtualdjDraft,
  files: string[],
  path: string,
): { file: string; xml: string; song: VirtualdjSong } | null {
  const wanted = path.normalize('NFC')
  for (const file of files) {
    const xml = draft.read(file)
    const song = xml && parseVirtualdjDatabase(xml).find((s) => s.path.normalize('NFC') === wanted)
    if (xml && song) return { file, xml, song }
  }
  return null
}

function applyVirtualdjOp(draft: VirtualdjDraft, op: QueueOp, files: string[]): OpOutcome {
  const refused = (code: 'cues-changed' | 'cues-invalid' | 'cues-write-failed'): OpOutcome => ({
    id: op.id,
    applied: false,
    notices: [{ code, track: op.kind === 'edit' ? '' : op.label }],
  })
  if (op.kind !== 'cues' || op.wanted === undefined || op.grid) return refused('cues-invalid')
  const found = songIn(draft, files, virtualdjFileOf(op.contentId))
  if (!found) return refused('cues-write-failed')
  const { file, xml, song } = found
  const rows = virtualdjCueRows(song)
  if (cueFingerprint(rows) !== op.fingerprint) return refused('cues-changed')
  const valid = validWantedSet(op.wanted, rows)
  if (!valid.ok) {
    log.warn(`VirtualDJ cues: refused the queued set for ${op.contentId} (${valid.reason})`)
    return refused('cues-invalid')
  }
  const calls = op.wanted.filter((c) => c.kind === 0).map((c) => c.ms)
  const notices: RekordboxQueueNotice[] =
    calls.length > 0 ? [{ code: 'cues-calls-dropped', track: op.label, calls }] : []
  const cues = op.wanted.filter((c) => c.kind !== 0).map((c) => cueOf(c, song))
  const next = withVirtualdjCues(xml, song.path, cues)
  if (next === null) return refused('cues-write-failed')
  draft.write(file, next)
  return { id: op.id, applied: true, notices }
}

export async function applyVirtualdjCuesBatch(
  ops: QueueOp[],
  deps: VirtualdjCommitDeps & {
    ensureClosed: () => Promise<boolean>
    stillQueued?: (id: string) => boolean
  },
): Promise<BatchResult> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (!(await deps.ensureClosed())) return { ok: false, reason: 'cancelled' }
    const draft = createVirtualdjDraft()
    const files = deps.roots().map(virtualdjDatabaseOf)
    const outcomes = ops.map(
      (op): OpOutcome =>
        deps.stillQueued && !deps.stillQueued(op.id)
          ? { id: op.id, applied: false, reason: 'cancelled', notices: [] }
          : applyVirtualdjOp(draft, op, files),
    )
    const written = await commitVirtualdjDraft(draft, deps)
    if (written === 'changed') continue
    if (written !== 'written' && written !== 'nothing') return { ok: false, reason: written }
    return { ok: true, wrote: written === 'written', outcomes }
  }
  log.info('VirtualDJ database kept changing while Surco wrote, nothing written')
  return { ok: false, reason: 'cancelled' }
}
