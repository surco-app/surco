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
// libraries it will touch still checking. from is the file the libraries followed (the copy
// replaced, else the source), source the file converted. traktorStranded marks a patch that
// could not follow its file (see redirectNmlPatch). engineStep marks an Engine row the job's
// own Engine DJ step wrote, which is there whatever the flush did.
export interface VerifyEntry {
  trackId: string
  from: string
  source: string
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
  engineStep?: boolean
  verification: Verification
}

// A patch by the source its entry is found by, the same identity the Traktor queue keeps
// (queuedNmlPatch.from): a queued patch comes back from JSON as another object.
export const traktorPatchKey = (patch: NmlPatch) =>
  [patch.volume, patch.dir, patch.file].map((s) => s.normalize('NFC')).join('\0')

// What a collection write knew: the FILE of the entry each patch matched in the NML it wrote
// over (matchedEntryFiles inside syncCollection), by traktorPatchKey, null where Traktor had
// no entry; or 'failed' when nothing was written.
export type TraktorWrite = { before: Map<string, string | null> } | 'failed'

// 'failed' is a write that went wrong or a flush that threw: nothing is known, nothing pending.
export interface FlushOutcome {
  rekordbox: 'written' | 'queued' | 'off' | 'failed'
  engine: 'written' | 'queued' | 'off' | 'failed'
  traktor: TraktorWrite | 'queued' | 'off'
}

// How a queue apply went; Traktor's carries its write's facts like the flush.
export type QueueApplied = 'written' | TraktorWrite

type Read<T> = Promise<T[] | 'unreadable'>

export interface VerifyRegistryDeps {
  emit: (trackId: string, v: Verification) => void
  readRekordbox: (list: VerifyEntry[]) => Read<PlaceCheck>
  readEngine: (list: VerifyEntry[]) => Read<PlaceCheck>
  readTraktor: (list: TraktorExpect[]) => Read<PlaceCheck | null>
  readFile: (e: FileExpect) => Promise<PlaceCheck>
  readMusic: (e: MusicExpect) => Promise<PlaceCheck>
  // True when the repoint is held in the queue because the program is open.
  requeue: (place: Library, e: VerifyEntry) => boolean
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
const checking = (place: Library): PlaceCheck => ({
  place,
  state: 'checking',
  detail: { key: 'checking' },
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
  if (place === 'engine') return e.engine !== 'absent' || e.engineStep === true
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
  // Tracks whose repoint sits in a queue, by place: re-checked when that queue applies.
  const awaiting: Record<Library, Set<VerifyEntry>> = {
    rekordbox: new Set(),
    engine: new Set(),
    traktor: new Set(),
  }
  let batch = new Set<VerifyEntry>()

  // A track converted again while its checks were running has a newer entry; the old
  // entry's results are never sent for it.
  const live = (e: VerifyEntry) => entries.get(e.trackId) === e

  const replace = (e: VerifyEntry, result: PlaceCheck | null, place: VerifyPlace) => {
    e.verification =
      result === null ? without(e.verification, place) : withChecks(e.verification, [result])
  }
  // Each update names the conversion it belongs to and counts up from the result's seq 0:
  // the renderer keeps only the newest word about the conversion it holds.
  const stamps = new WeakMap<VerifyEntry, { job?: string; seq: number }>()
  const emit = (e: VerifyEntry) => {
    if (!live(e)) return
    const stamp = stamps.get(e) ?? { seq: 0 }
    stamp.seq += 1
    deps.emit(e.trackId, { ...e.verification, job: stamp.job, seq: stamp.seq })
  }

  // Tracks a flush, a queue apply or a retry is still working on: a new batch must not clear
  // one that turned ok halfway, or its emit would find it gone.
  const working = new Map<VerifyEntry, number>()
  async function during<T>(list: VerifyEntry[], work: () => Promise<T>): Promise<T> {
    for (const e of list) working.set(e, (working.get(e) ?? 0) + 1)
    try {
      return await work()
    } finally {
      for (const e of list) {
        const n = (working.get(e) ?? 1) - 1
        if (n === 0) working.delete(e)
        else working.set(e, n)
      }
    }
  }

  const hold = (place: Library, e: VerifyEntry) => {
    awaiting[place].add(e)
    replace(e, pending(place), place)
  }

  // result null re-reads what is there with the facts already known.
  async function check(place: Library, list: VerifyEntry[], result: QueueApplied | null) {
    for (const e of list) awaiting[place].delete(e)
    if (place === 'traktor') return checkTraktor(list, result)
    if (list.length === 0) return
    if (result === 'failed') {
      for (const e of list) replace(e, unreadable(place), place)
      return
    }
    const read = place === 'rekordbox' ? deps.readRekordbox : deps.readEngine
    settle(place, list, await read(list).catch(() => 'unreadable' as const))
  }

  // A reader that answered for some other number of tracks cannot be lined up with them.
  function settle(
    place: Library,
    list: VerifyEntry[],
    results: (PlaceCheck | null)[] | 'unreadable',
  ) {
    const aligned = results !== 'unreadable' && results.length === list.length
    list.forEach((e, i) => {
      replace(e, aligned ? results[i] : unreadable(place), place)
    })
  }

  async function checkTraktor(list: VerifyEntry[], result: QueueApplied | null) {
    const expects: { e: VerifyEntry; expect: TraktorExpect }[] = []
    for (const e of list) {
      const patch = e.traktorPatch
      if (result === 'failed' || result === 'written' || !patch) traktorBefore.delete(e.trackId)
      else if (result) {
        const key = traktorPatchKey(patch)
        if (result.before.has(key)) traktorBefore.set(e.trackId, result.before.get(key) ?? null)
        else traktorBefore.delete(e.trackId)
      }
      const before = traktorBefore.get(e.trackId)
      if (!patch || before === undefined) replace(e, unreadable('traktor'), 'traktor')
      else expects.push({ e, expect: { patch, before, stranded: e.traktorStranded ?? false } })
    }
    if (expects.length === 0) return
    const results = await deps
      .readTraktor(expects.map((x) => x.expect))
      .catch(() => 'unreadable' as const)
    settle(
      'traktor',
      expects.map((x) => x.e),
      results,
    )
  }

  return {
    // The first track of a new batch clears the tracks already verified: nothing more can
    // happen to them, and the registry stays the size of what is still open.
    register(e: VerifyEntry): void {
      if (batch.size === 0)
        for (const [id, old] of entries)
          if (old.verification.status === 'ok' && !working.has(old)) {
            entries.delete(id)
            traktorBefore.delete(id)
          }
      const previous = entries.get(e.trackId)
      if (previous) for (const place of LIBRARIES) awaiting[place].delete(previous)
      entries.set(e.trackId, e)
      stamps.set(e, { job: e.verification.job, seq: e.verification.seq ?? 0 })
      traktorBefore.delete(e.trackId)
      batch.add(e)
    },

    async afterFlush(outcome: FlushOutcome): Promise<void> {
      const flushed = [...batch].filter(live)
      batch = new Set()
      await during(flushed, () =>
        Promise.all(
          LIBRARIES.map(async (place) => {
            const listed = flushed.filter((e) => e.places.has(place))
            const touched = listed.filter((e) => touches(e, place))
            const byJob = touched.filter((e) => place === 'engine' && e.engineStep)
            const byFlush = touched.filter((e) => !byJob.includes(e))
            const result = outcome[place]
            for (const e of listed)
              if (!touched.includes(e) || (result === 'off' && byFlush.includes(e)))
                replace(e, null, place)
            if (result === 'queued') for (const e of byFlush) hold(place, e)
            await Promise.all([
              check(place, byJob, null),
              result === 'off' || result === 'queued' ? undefined : check(place, byFlush, result),
            ])
          }),
        ),
      )
      for (const e of flushed) emit(e)
    },

    async afterQueueApplied(place: Library, result: QueueApplied): Promise<void> {
      const held = [...awaiting[place]]
      await during(held, () => check(place, held, result))
      for (const e of held) emit(e)
    },

    // The worst place decides: a file or Music entry that does not add up is converted again
    // while its source is there to convert from, and only re-read once the source is gone
    // (the only copy left would be the suspect file). A library is handed its repoint again
    // and re-checked when the queue applies; a place that could not be read is read again.
    async retry(trackId: string): Promise<'rerun-job' | 'rechecked'> {
      const e = entries.get(trackId)
      if (!e) throw new Error('verifyUnknownTrack')
      return during([e], () => recheck(e))
    },

    get(trackId: string): Verification | undefined {
      return entries.get(trackId)?.verification
    },
  }

  async function recheck(e: VerifyEntry): Promise<'rerun-job' | 'rechecked'> {
    const bad = (place: VerifyPlace) => stateOf(e, place) === 'mismatch'
    const sourceGone =
      (bad('file') || bad('appleMusic')) &&
      (e.source.normalize('NFC') === e.to.normalize('NFC') || !(await deps.exists(e.source)))
    if ((bad('file') || bad('appleMusic')) && !sourceGone) return 'rerun-job'

    const rereadFile = sourceGone || stateOf(e, 'file') === 'unreadable'
    const rereadMusic =
      e.music !== undefined && (sourceGone || stateOf(e, 'appleMusic') === 'unreadable')
    if (rereadFile) replace(e, await deps.readFile(e.file), 'file')
    if (rereadMusic && e.music) replace(e, await deps.readMusic(e.music), 'appleMusic')
    if (sourceGone && bad('file'))
      replace(
        e,
        {
          place: 'file',
          state: 'mismatch',
          detail: { key: 'fileSourceGone', params: { kept: e.originalKept ? 1 : 0 } },
        },
        'file',
      )
    for (const place of LIBRARIES) {
      const state = stateOf(e, place)
      if (state === 'unreadable') await check(place, [e], null)
      else if (state === 'mismatch') {
        hold(place, e)
        if (!deps.requeue(place, e) && stateOf(e, place) === 'pending')
          replace(e, checking(place), place)
      }
    }
    emit(e)
    return 'rechecked'
  }
}
