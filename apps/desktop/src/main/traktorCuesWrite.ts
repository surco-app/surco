import { readFile } from 'node:fs/promises'
import log from 'electron-log/main'
import { HOT_KINDS, validWantedSet, type WantedCue } from '../shared/cueRules'
import { TRAKTOR_HOT_OFFSET, traktorKey } from '../shared/traktorContent'
import type { RekordboxEditRefusal, RekordboxQueueNotice } from '../shared/types'
import type { BatchResult, OpOutcome, QueueOp } from './rekordboxQueueOps'
import {
  readTraktorTrackCues,
  traktorCueElements,
  traktorCueRows,
  traktorEntryBlock,
} from './traktorCues'
import { writeCollection } from './traktorNmlLibrary'

const NO_BUTTON = HOT_KINDS[HOT_KINDS.length - 1]

export interface TraktorCuesWriteDeps {
  ensureClosed: () => Promise<boolean>
  write?: typeof writeCollection
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
      return was.element.replace(/\bHOTCUE="[^"]*"/, `HOTCUE="${buttonOf(w.kind)}"`)
    })
  if (!changed && cues.length === rows.length) return block
  const all = [...kept, ...cues]
  if (elements.length === 0) {
    const close = block.lastIndexOf('</ENTRY>')
    return `${block.slice(0, close)}${all.map((el) => `${el}\n`).join('')}${block.slice(close)}`
  }
  const first = elements[0]
  const last = elements[elements.length - 1]
  const separator = elements[1] ? block.slice(first.end, elements[1].start) : '\n'
  return `${block.slice(0, first.start)}${all.join(separator)}${block.slice(last.end)}`
}

function refusalOf(reason: string): RekordboxEditRefusal {
  if (reason === 'traktor-running') return 'rekordbox-running'
  if (reason === 'backup-failed' || reason === 'unreadable') return reason
  return 'write-failed'
}

export async function applyTraktorCuesBatch(
  nmlPath: string,
  ops: QueueOp[],
  deps: TraktorCuesWriteDeps,
): Promise<BatchResult> {
  if (!nmlPath) return { ok: false, reason: 'unreadable' }
  let original: string
  try {
    original = await readFile(nmlPath, 'utf8')
  } catch (e) {
    log.warn(`Traktor cues: cannot read ${nmlPath}: ${(e as Error).message}`)
    return { ok: false, reason: 'unreadable' }
  }
  let nml = original
  const outcomes: OpOutcome[] = ops.map((op) => {
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
  if (nml === original) return { ok: true, wrote: false, outcomes }
  if (!(await deps.ensureClosed())) return { ok: false, reason: 'cancelled' }
  const failure = await (deps.write ?? writeCollection)(nmlPath, nml)
  if (failure) return { ok: false, reason: refusalOf(failure) }
  return { ok: true, wrote: true, outcomes }
}
