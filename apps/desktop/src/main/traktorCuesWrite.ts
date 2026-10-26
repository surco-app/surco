import { readFile } from 'node:fs/promises'
import log from 'electron-log/main'
import { HOT_KINDS, validWantedSet, type WantedCue } from '../shared/cueRules'
import { TRAKTOR_HOT_OFFSET, traktorKey } from '../shared/traktorContent'
import type { RekordboxEditRefusal, RekordboxQueueNotice } from '../shared/types'
import type { BatchResult, EditOp, OpOutcome, QueueOp } from './rekordboxQueueOps'
import {
  readTraktorTrackCues,
  traktorCueElements,
  traktorCueRows,
  traktorCuesIntact,
  traktorEntryBlock,
} from './traktorCues'
import { withAttr } from './traktorNml'
import { bootVolumeName, writeCollection } from './traktorNmlLibrary'
import { applyTraktorEdits } from './traktorPlaylistEdit'

const NO_BUTTON = HOT_KINDS[HOT_KINDS.length - 1]

export interface TraktorCuesWriteDeps {
  ensureClosed: () => Promise<boolean>
  write?: typeof writeCollection
  bootVolume?: string
}

function buttonOf(kind: number): number {
  return kind === 0 ? -1 : HOT_KINDS.indexOf(kind) + TRAKTOR_HOT_OFFSET
}

function newCue(w: WantedCue): string {
  return `<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="0" START="${w.ms.toFixed(6)}" LEN="0.000000" REPEATS="-1" HOTCUE="${buttonOf(w.kind)}"></CUE_V2>`
}

// Rewrites only the cues Surco edits. The grid marker, button 1 and anything kept as it
// was are copied verbatim; a cue Surco adds or moves is a plain Traktor cue (TYPE 0),
// the one type the DJ asked Surco to write. Cue H has no Traktor button and is left out.
export function withTraktorCues(block: string, wanted: WantedCue[]): string {
  const rows = traktorCueRows(block)
  const editable = new Set(rows.map((r) => r.start))
  const elements = traktorCueElements(block)
  const kept = elements.filter((el) => !editable.has(el.start)).map((el) => el.element)
  let changed = false
  const cues = wanted
    .filter((w) => w.kind !== NO_BUTTON)
    .map((w) => {
      const was = rows.find((r) => r.id === w.id)
      if (!was || was.ms !== w.ms) {
        changed = true
        return newCue(w)
      }
      if (was.kind === w.kind) return was.element
      changed = true
      return withAttr(was.element, 'HOTCUE', String(buttonOf(w.kind)))
    })
  if (!changed && cues.length === rows.length) return block
  const all = [...kept, ...cues]
  const eol = block.includes('\r\n') ? '\r\n' : '\n'
  if (elements.length === 0) {
    const close = block.lastIndexOf('</ENTRY>')
    return `${block.slice(0, close)}${all.map((el) => `${el}${eol}`).join('')}${block.slice(close)}`
  }
  const first = elements[0]
  const last = elements[elements.length - 1]
  const separator = elements[1] ? block.slice(first.end, elements[1].start) : eol
  return `${block.slice(0, first.start)}${all.join(separator)}${block.slice(last.end)}`
}

function refusalOf(reason: string): RekordboxEditRefusal {
  if (reason === 'traktor-running') return 'rekordbox-running'
  if (reason === 'backup-failed' || reason === 'unreadable') return reason
  return 'write-failed'
}

// Everything the batch would write, worked out on one reading of the collection.
function planBatch(
  text: string,
  ops: QueueOp[],
  bootVolume: string,
): { nml: string; outcomes: OpOutcome[] } {
  const edits = applyTraktorEdits(
    text,
    ops.filter((op): op is EditOp => op.kind === 'edit'),
    bootVolume,
  )
  let nml = edits.nml
  const outcomes: OpOutcome[] = ops.map((op) => {
    const edited = edits.outcomes.get(op.id)
    if (edited) return edited
    const refused = (code: 'cues-changed' | 'cues-invalid'): OpOutcome => ({
      id: op.id,
      applied: false,
      notices: [{ code, track: op.kind === 'edit' ? '' : op.label }],
    })
    if (op.kind !== 'cues') return refused('cues-invalid')
    const key = traktorKey(op.contentId)
    const entry = key === null ? null : traktorEntryBlock(nml, key)
    const read = entry && readTraktorTrackCues(nml, op.contentId)
    if (!entry || !read || read.fingerprint !== op.fingerprint) return refused('cues-changed')
    if (!traktorCuesIntact(entry.block)) {
      log.warn(`Traktor cues: an unreadable CUE_V2 in ${op.contentId}, left as it was`)
      return refused('cues-invalid')
    }
    if (op.wanted === undefined) return refused('cues-invalid')
    const valid = validWantedSet(op.wanted, read.cues)
    if (!valid.ok) {
      log.warn(`Traktor cues: refused the queued set for ${op.contentId} (${valid.reason})`)
      return refused('cues-invalid')
    }
    const notices: RekordboxQueueNotice[] = op.wanted.some((w) => w.kind === NO_BUTTON)
      ? [{ code: 'cues-slot-dropped', track: op.label }]
      : []
    const next = withTraktorCues(entry.block, op.wanted)
    nml = `${nml.slice(0, entry.start)}${next}${nml.slice(entry.end)}`
    return { id: op.id, applied: true, notices }
  })
  return { nml, outcomes }
}

// Playlist edits and cue saves queued while Traktor was open go out together, in one
// write: the edits first, since they rewrite only <PLAYLISTS>, which sits after every
// ENTRY the cue saves then locate afresh.
export async function applyTraktorBatch(
  nmlPath: string,
  ops: QueueOp[],
  deps: TraktorCuesWriteDeps,
): Promise<BatchResult> {
  if (!nmlPath) return { ok: false, reason: 'unreadable' }
  const read = async (): Promise<string | null> =>
    readFile(nmlPath, 'utf8').catch((e) => {
      log.warn(`Traktor cues: cannot read ${nmlPath}: ${(e as Error).message}`)
      return null
    })
  const bootVolume = deps.bootVolume ?? bootVolumeName()
  const original = await read()
  if (original === null) return { ok: false, reason: 'unreadable' }
  const first = planBatch(original, ops, bootVolume)
  if (first.nml === original) return { ok: true, wrote: false, outcomes: first.outcomes }
  // Closing Traktor makes it save the collection on its way out, so what was read above
  // is out of date the moment it quits: the batch is worked out again on what it saved,
  // which is also what catches a set the DJ changed in Traktor meanwhile.
  if (!(await deps.ensureClosed())) return { ok: false, reason: 'cancelled' }
  const fresh = await read()
  if (fresh === null) return { ok: false, reason: 'unreadable' }
  const { nml, outcomes } = planBatch(fresh, ops, bootVolume)
  if (nml === fresh) return { ok: true, wrote: false, outcomes }
  const failure = await (deps.write ?? writeCollection)(nmlPath, nml)
  if (failure) return { ok: false, reason: refusalOf(failure) }
  return { ok: true, wrote: true, outcomes }
}
