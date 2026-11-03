import { constants as fsConstants } from 'node:fs'
import { copyFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import log from 'electron-log/main'
import { HOT_KINDS, validWantedSet, type WantedCue } from '../shared/cueRules'
import { hotCueArgb, nearestHotCueColor } from '../shared/rekordboxCueColors'
import { seratoFileOf } from '../shared/seratoContent'
import { type SeratoCue, withSeratoCues } from '../shared/seratoMarkers'
import type { RekordboxQueueNotice, TrashEntry } from '../shared/types'
import { assertDecodable, convertTmpPath } from './ffmpeg'
import { dropTemp, type Rewritten, type TmpTracking } from './musicFieldWrite'
import { discardBackup, hasOriginalKeeper, keepOriginal } from './originalKeeper'
import { cueFingerprint } from './rekordboxCues'
import type { BatchResult, OpOutcome, QueueOp } from './rekordboxQueueOps'
import { renameWithRetry } from './renameRetry'
import { seratoLeadOfFile } from './seratoClock'
import { seratoCueRows } from './seratoCueSource'
import { readSeratoTrack } from './seratoTags'
import { runInWorker } from './worker'

export interface SeratoWriteDeps {
  tracking?: TmpTracking
  rewritten?: Rewritten
}

const sameBytes = (a: Uint8Array | null, b: Uint8Array): boolean =>
  a !== null && Buffer.from(a).equals(Buffer.from(b))

export async function writeSeratoCues(
  file: string,
  wanted: SeratoCue[],
  expectedFingerprint: string,
  { tracking, rewritten }: SeratoWriteDeps = {},
): Promise<'written' | 'changed' | 'failed'> {
  const tmp = convertTmpPath(file, extname(file))
  tracking?.track(tmp)
  let archived: TrashEntry | null = null
  try {
    const fromBytes = (await stat(file)).size
    await copyFile(file, tmp, fsConstants.COPYFILE_FICLONE)
    const track = readSeratoTrack(tmp)
    if (!track) throw new Error(`no tags read from ${tmp}`)
    const lead = await seratoLeadOfFile(tmp, track.sampleRate)
    if (cueFingerprint(seratoCueRows(track.markers?.cues ?? [], lead)) !== expectedFingerprint) {
      await dropTemp(tmp, tracking)
      return 'changed'
    }
    const payload = withSeratoCues(
      track.payload,
      wanted.map((cue) => ({ ...cue, ms: Math.max(0, Math.round(cue.ms + lead)) })),
    )
    await runInWorker({ type: 'setSeratoMarkers', file: tmp, payload })
    if (!sameBytes(readSeratoTrack(tmp)?.payload ?? null, payload))
      throw new Error(`Serato cues did not read back from ${tmp}`)
    await assertDecodable(tmp, file)
    archived = await keepOriginal(file, 'replaced', file, {
      reencodes: false,
      regardlessOfPolicy: true,
    })
    if (!archived && hasOriginalKeeper()) throw new Error(`no backup of ${file}`)
    await renameWithRetry(tmp, file)
    tracking?.untrack(tmp)
    rewritten?.(file, fromBytes)
    return 'written'
  } catch (e) {
    log.warn(`Serato cues not written to ${file}`, e)
    if (archived) await discardBackup(archived).catch(() => undefined)
    await dropTemp(tmp, tracking)
    return 'failed'
  }
}

const surcoColorOf = (rgb: number): number => nearestHotCueColor((0xff000000 | rgb) >>> 0)

function seratoCueOf(wanted: WantedCue, was: SeratoCue[]): SeratoCue {
  const before = was.find((c) => String(c.index) === wanted.id)
  const kept = before && wanted.color !== null && surcoColorOf(before.color) === wanted.color
  return {
    index: HOT_KINDS.indexOf(wanted.kind),
    ms: wanted.ms,
    color: kept ? before.color : hotCueArgb(wanted.color) & 0xffffff,
    name: before?.name ?? '',
  }
}

const sameCues = (a: SeratoCue[], b: SeratoCue[]): boolean => {
  const byIndex = (cues: SeratoCue[]) => [...cues].sort((x, y) => x.index - y.index)
  return JSON.stringify(byIndex(a)) === JSON.stringify(byIndex(b))
}

const onSeratoClock = (cues: SeratoCue[], lead: number): SeratoCue[] =>
  cues.map((c) => ({ ...c, ms: Math.max(0, Math.round(c.ms + lead)) }))

async function applySeratoOp(
  op: QueueOp,
  deps: SeratoWriteDeps,
): Promise<{ outcome: OpOutcome; wrote: boolean }> {
  const refused = (code: 'cues-changed' | 'cues-invalid' | 'cues-write-failed') => ({
    outcome: {
      id: op.id,
      applied: false,
      notices: [{ code, track: op.kind === 'edit' ? '' : op.label }],
    },
    wrote: false,
  })
  if (op.kind !== 'cues' || op.wanted === undefined || op.grid) return refused('cues-invalid')
  const file = seratoFileOf(op.contentId)
  const track = readSeratoTrack(file)
  if (!track) return refused('cues-write-failed')
  const lead = await seratoLeadOfFile(file, track.sampleRate)
  const was = track.markers?.cues ?? []
  const calls = op.wanted.filter((c) => c.kind === 0).map((c) => c.ms)
  const notices: RekordboxQueueNotice[] =
    calls.length > 0 ? [{ code: 'cues-calls-dropped', track: op.label, calls }] : []
  const upper = was
    .filter((c) => c.index >= HOT_KINDS.length)
    .map((c) => ({ ...c, ms: c.ms - lead }))
  const cues = [...op.wanted.filter((c) => c.kind !== 0).map((c) => seratoCueOf(c, was)), ...upper]
  const applied = { outcome: { id: op.id, applied: true, notices }, wrote: true }
  if (sameCues(onSeratoClock(cues, lead), was)) return { ...applied, wrote: false }
  const rows = seratoCueRows(was, lead)
  if (cueFingerprint(rows) !== op.fingerprint) return refused('cues-changed')
  const valid = validWantedSet(op.wanted, rows)
  if (!valid.ok) {
    log.warn(`Serato cues: refused the queued set for ${op.contentId} (${valid.reason})`)
    return refused('cues-invalid')
  }
  const result = await writeSeratoCues(file, cues, op.fingerprint, deps)
  if (result === 'changed') return refused('cues-changed')
  if (result === 'failed') return refused('cues-write-failed')
  return applied
}

export async function applySeratoCuesBatch(
  ops: QueueOp[],
  deps: SeratoWriteDeps & {
    ensureClosed: () => Promise<boolean>
    stillQueued?: (id: string) => boolean
  },
): Promise<BatchResult> {
  const results: { outcome: OpOutcome; wrote: boolean }[] = []
  for (const op of ops) {
    if (deps.stillQueued && !deps.stillQueued(op.id)) {
      results.push({
        outcome: { id: op.id, applied: false, reason: 'cancelled', notices: [] },
        wrote: false,
      })
      continue
    }
    if (!(await deps.ensureClosed())) return { ok: false, reason: 'cancelled' }
    results.push(await applySeratoOp(op, deps))
  }
  return {
    ok: true,
    wrote: results.some((r) => r.wrote),
    outcomes: results.map((r) => r.outcome),
  }
}
