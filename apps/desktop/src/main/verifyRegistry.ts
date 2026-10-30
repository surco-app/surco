import {
  type PlaceCheck,
  type Verification,
  type VerifyPlace,
  verificationStatus,
  withChecks,
} from '../shared/verification'
import type { NmlPatch } from './traktorNml'
import type { EngineBefore } from './verifyEngine'
import type { FileExpect } from './verifyFile'
import type { MusicExpect } from './verifyMusic'
import type { RekordboxBefore } from './verifyRekordbox'
import type { TraktorExpect } from './verifyTraktor'

type Library = 'rekordbox' | 'engine' | 'traktor'

// One conversion as the job left it: the file and Music already judged in verification, the
// libraries it will touch still checking. traktorStranded marks a patch that could not follow
// its file (see redirectNmlPatch).
export interface VerifyEntry {
  trackId: string
  from: string
  to: string
  samplesKept: boolean
  originalKept: boolean
  places: Set<VerifyPlace>
  file: FileExpect
  music?: MusicExpect
  rekordbox?: RekordboxBefore
  engine?: EngineBefore
  traktorPatch?: NmlPatch
  traktorStranded?: boolean
  verification: Verification
}

// What a collection write knew: the FILE of the entry each patch matched in the NML it wrote
// over (matchedEntryFiles inside syncCollection), or 'failed' when nothing was written.
export type TraktorWrite = { before: Map<NmlPatch, string | null> } | 'failed'

export interface FlushOutcome {
  rekordbox: 'written' | 'queued' | 'off'
  engine: 'written' | 'queued' | 'off'
  traktor: TraktorWrite | 'queued' | 'off'
}

type Read<T> = Promise<T[] | 'unreadable'>

export interface VerifyRegistryDeps {
  emit: (trackId: string, v: Verification) => void
  readRekordbox: (list: VerifyEntry[]) => Read<PlaceCheck>
  readEngine: (list: VerifyEntry[]) => Read<PlaceCheck>
  readTraktor: (list: TraktorExpect[]) => Read<PlaceCheck | null>
  readFile: (e: FileExpect) => Promise<PlaceCheck>
  readMusic: (e: MusicExpect) => Promise<PlaceCheck>
  requeue: (place: Library, e: VerifyEntry) => void
  exists: (path: string) => Promise<boolean>
}

const LIBRARIES: Library[] = ['rekordbox', 'engine', 'traktor']
const PROGRAM: Record<Library, string> = {
  rekordbox: 'rekordbox',
  engine: 'Engine DJ',
  traktor: 'Traktor',
}

const pending = (place: Library): PlaceCheck => ({
  place,
  state: 'pending',
  detail: { key: 'pending', params: { program: PROGRAM[place] } },
})
const unreadable = (place: Library): PlaceCheck => ({
  place,
  state: 'unreadable',
  detail: { key: `${place}Unreadable` },
})

const without = (v: Verification, place: VerifyPlace): Verification => {
  const checks = v.checks.filter((c) => c.place !== place)
  return { status: verificationStatus(checks), checks }
}

// A source with no row in rekordbox or Engine was never touched there: nothing to list.
function touches(e: VerifyEntry, place: VerifyPlace): boolean {
  if (!e.places.has(place)) return false
  if (place === 'rekordbox') return e.rekordbox !== 'absent'
  if (place === 'engine') return e.engine !== 'absent'
  if (place === 'traktor') return e.traktorPatch !== undefined
  return true
}

const stateOf = (e: VerifyEntry, place: VerifyPlace) =>
  e.verification.checks.find((c) => c.place === place)?.state

export function createVerifyRegistry(deps: VerifyRegistryDeps) {
  const entries = new Map<string, VerifyEntry>()
  // The Traktor fact each track was last written with, kept for a later re-read. A track
  // with none was never written, and its re-read cannot say anything.
  const traktorBefore = new Map<string, string | null>()
  let batch: string[] = []

  const replace = (e: VerifyEntry, result: PlaceCheck | null, place: Library) => {
    e.verification =
      result === null ? without(e.verification, place) : withChecks(e.verification, [result])
  }

  async function check(place: Library, list: VerifyEntry[], write?: TraktorWrite) {
    if (place === 'traktor') return checkTraktor(list, write)
    if (list.length === 0) return
    const read = place === 'rekordbox' ? deps.readRekordbox : deps.readEngine
    const results = await read(list).catch(() => 'unreadable' as const)
    list.forEach((e, i) => {
      replace(e, results === 'unreadable' ? unreadable(place) : results[i], place)
    })
  }

  async function checkTraktor(list: VerifyEntry[], write?: TraktorWrite) {
    const expects: { e: VerifyEntry; expect: TraktorExpect }[] = []
    for (const e of list) {
      const patch = e.traktorPatch
      if (write === 'failed' || !patch) traktorBefore.delete(e.trackId)
      else if (write) traktorBefore.set(e.trackId, write.before.get(patch) ?? null)
      const before = traktorBefore.get(e.trackId)
      if (!patch || before === undefined) replace(e, unreadable('traktor'), 'traktor')
      else expects.push({ e, expect: { patch, before, stranded: e.traktorStranded ?? false } })
    }
    if (expects.length === 0) return
    const results = await deps
      .readTraktor(expects.map((x) => x.expect))
      .catch(() => 'unreadable' as const)
    expects.forEach(({ e }, i) => {
      replace(e, results === 'unreadable' ? unreadable('traktor') : results[i], 'traktor')
    })
  }

  return {
    register(e: VerifyEntry): void {
      entries.set(e.trackId, e)
      traktorBefore.delete(e.trackId)
      batch.push(e.trackId)
    },

    async afterFlush(outcome: FlushOutcome): Promise<void> {
      const flushed = batch.flatMap((id) => entries.get(id) ?? [])
      batch = []
      await Promise.all(
        LIBRARIES.map(async (place) => {
          const listed = flushed.filter((e) => e.places.has(place))
          const touched = listed.filter((e) => touches(e, place))
          const result = outcome[place]
          for (const e of listed)
            if (!touched.includes(e) || result === 'off') replace(e, null, place)
          if (result === 'off') return
          if (result === 'queued') for (const e of touched) replace(e, pending(place), place)
          else await check(place, touched, result === 'written' ? undefined : result)
        }),
      )
      for (const e of flushed) deps.emit(e.trackId, e.verification)
    },

    async afterQueueApplied(place: Library, write?: TraktorWrite): Promise<void> {
      const held = [...entries.values()].filter((e) => stateOf(e, place) === 'pending')
      await check(place, held, place === 'traktor' ? (write ?? 'failed') : undefined)
      for (const e of held) deps.emit(e.trackId, e.verification)
    },

    // The worst place decides: a file or Music entry that does not add up is converted again
    // while its source is there to convert from, and only re-read once the source is gone
    // (the only copy left would be the suspect file). A library is handed its repoint again
    // and re-checked when the queue applies; a place that could not be read is read again.
    async retry(trackId: string): Promise<'rerun-job' | 'rechecked'> {
      const e = entries.get(trackId)
      if (!e) throw new Error('verifyUnknownTrack')
      const bad = (place: VerifyPlace) => stateOf(e, place) === 'mismatch'
      const sourceGone =
        (bad('file') || bad('appleMusic')) &&
        (e.from.normalize('NFC') === e.to.normalize('NFC') || !(await deps.exists(e.from)))
      if ((bad('file') || bad('appleMusic')) && !sourceGone) return 'rerun-job'

      if (sourceGone || stateOf(e, 'file') === 'unreadable')
        e.verification = withChecks(e.verification, [await deps.readFile(e.file)])
      if (e.music && (sourceGone || stateOf(e, 'appleMusic') === 'unreadable'))
        e.verification = withChecks(e.verification, [await deps.readMusic(e.music)])
      if (sourceGone && bad('file'))
        e.verification = withChecks(e.verification, [
          {
            place: 'file',
            state: 'mismatch',
            detail: { key: 'fileSourceGone', params: { kept: e.originalKept ? 1 : 0 } },
          },
        ])
      for (const place of LIBRARIES) {
        const state = stateOf(e, place)
        if (state === 'unreadable') await check(place, [e])
        else if (state === 'mismatch') {
          deps.requeue(place, e)
          replace(e, pending(place), place)
        }
      }
      deps.emit(e.trackId, e.verification)
      return 'rechecked'
    },

    get(trackId: string): Verification | undefined {
      return entries.get(trackId)?.verification
    },
  }
}
