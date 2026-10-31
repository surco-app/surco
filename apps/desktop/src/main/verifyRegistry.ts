import { errorWithKey } from '../shared/errorKeys'
import {
  type PlaceCheck,
  type Verification,
  type VerifyPlace,
  verificationStatus,
  withChecks,
} from '../shared/verification'
import type { EngineShift } from './engineRepoint'
import { settleHeldOriginal } from './originalKeeper'
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
  // How the conversion moved the cues in rekordbox's timeline (the repoint's audio), handed
  // again with a repoint the library never applied.
  cueShiftMs?: number
  // The same move as Engine DJ counts it, handed again with the repoint and expected of the row.
  engineShift?: EngineShift
  // The source's size before a rewrite in place, handed again with the repoint.
  fromBytes?: number
  // The original held under «Nunca» for this verdict (claimHeldOriginal).
  heldOriginal?: string
  verification: Verification
}

// A patch by the source its entry is found by, the same identity the Traktor queue keeps
// (queuedNmlPatch.from): a queued patch comes back from JSON as another object.
export const traktorPatchKey = (patch: NmlPatch) =>
  [patch.volume, patch.dir, patch.file].map((s) => s.normalize('NFC')).join('\0')

// What a collection write knew: the FILE of the entry each patch matched in the NML it wrote
// over (matchedEntryFiles inside syncCollection), by traktorPatchKey, null where Traktor had
// no entry, and that entry's cues as the same read found them; or 'failed' when nothing was
// written.
export type TraktorWrite =
  | { before: Map<string, string | null>; cues?: Map<string, string | null> }
  | 'failed'

// 'failed' is a write that went wrong or a flush that threw: nothing is known, nothing pending.
// 'later' is an end nested in a batch still open: it took nothing, the outer end will.
export interface FlushOutcome {
  rekordbox: 'written' | 'queued' | 'off' | 'failed' | 'later'
  engine: 'written' | 'queued' | 'off' | 'failed' | 'later'
  traktor: TraktorWrite | 'queued' | 'off' | 'later'
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
  // True when the library is not there to take the repoint now: it waits in the queue until
  // the library is back. One found open is told by the apply (afterQueueWaits).
  requeue: (place: Library, e: VerifyEntry) => boolean
  exists: (path: string) => Promise<boolean>
  // Two spellings of one file as the libraries resolve them (links, case, composition).
  samePath?: (a: string, b: string) => boolean
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
  const samePath =
    deps.samePath ?? ((a: string, b: string) => a.normalize('NFC') === b.normalize('NFC'))
  // A conversion written over its own path is found by the repoint on the row it already
  // moved, which would shift its cues again.
  const stillOld = (e: VerifyEntry, place: Library) =>
    !samePath(e.from, e.to) &&
    e.verification.checks.find((c) => c.place === place)?.detail.key === `${place}StillOld`
  // A Traktor patch no write ever matched has nothing to be read against: only writing it
  // again can tell.
  const neverWritten = (e: VerifyEntry, place: Library) =>
    place === 'traktor' &&
    e.traktorPatch !== undefined &&
    stateOf(e, place) === 'unreadable' &&
    !traktorBefore.has(e.trackId) &&
    !samePath(e.from, e.to)
  const entries = new Map<string, VerifyEntry>()
  // The Traktor fact each track was last written with, kept for a later re-read. A track
  // with none was never written, and its re-read cannot say anything.
  const traktorBefore = new Map<string, string | null>()
  const traktorCues = new Map<string, string | null>()
  // Tracks whose repoint sits in a queue, by place: re-checked when that queue applies.
  const awaiting: Record<Library, Set<VerifyEntry>> = {
    rekordbox: new Set(),
    engine: new Set(),
    traktor: new Set(),
  }
  // Tracks no flush has judged yet, by library, with the order they were registered in: a
  // flush judges only what was registered before its batch ended, and leaves a library it
  // took nothing from for the end that will.
  const unflushed: Record<Library, Set<VerifyEntry>> = {
    rekordbox: new Set(),
    engine: new Set(),
    traktor: new Set(),
  }
  const order = new WeakMap<VerifyEntry, number>()
  let registered = 0

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
    const stamp = stamps.get(e) ?? { job: e.verification.job, seq: 0 }
    stamps.set(e, stamp)
    stamp.seq += 1
    const originalHeld = settleHeldOriginal(e.heldOriginal, e.verification.status)
    deps.emit(e.trackId, {
      ...e.verification,
      job: stamp.job,
      seq: stamp.seq,
      ...(originalHeld ? { originalHeld } : {}),
    })
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
      // A failed write changed nothing: what the last one matched still holds.
      if (result === 'written' || !patch) traktorBefore.delete(e.trackId)
      else if (result && result !== 'failed') {
        const key = traktorPatchKey(patch)
        if (result.before.has(key)) traktorBefore.set(e.trackId, result.before.get(key) ?? null)
        else traktorBefore.delete(e.trackId)
        const cues = result.cues?.get(key)
        if (cues === undefined) traktorCues.delete(e.trackId)
        else traktorCues.set(e.trackId, cues)
      }
      const before = traktorBefore.get(e.trackId)
      if (result === 'failed' || !patch || before === undefined)
        replace(e, unreadable('traktor'), 'traktor')
      else
        expects.push({
          e,
          expect: {
            patch,
            before,
            cues: traktorCues.get(e.trackId),
            stranded: e.traktorStranded ?? false,
          },
        })
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
      if (LIBRARIES.every((place) => unflushed[place].size === 0))
        for (const [id, old] of entries)
          if (old.verification.status === 'ok' && !working.has(old)) {
            entries.delete(id)
            traktorBefore.delete(id)
            traktorCues.delete(id)
          }
      const previous = entries.get(e.trackId)
      if (previous)
        for (const place of LIBRARIES) {
          awaiting[place].delete(previous)
          unflushed[place].delete(previous)
        }
      entries.set(e.trackId, e)
      stamps.set(e, { job: e.verification.job, seq: e.verification.seq ?? 0 })
      traktorBefore.delete(e.trackId)
      traktorCues.delete(e.trackId)
      registered += 1
      order.set(e, registered)
      for (const place of LIBRARIES) unflushed[place].add(e)
    },

    // Where a batch ends: its flush judges the tracks registered up to here.
    cut(): number {
      return registered
    },

    async afterFlush(outcome: FlushOutcome, upTo = registered): Promise<void> {
      const mine = {} as Record<Library, VerifyEntry[]>
      for (const place of LIBRARIES) {
        mine[place] =
          outcome[place] === 'later'
            ? []
            : [...unflushed[place]].filter((e) => (order.get(e) ?? 0) <= upTo)
        for (const e of mine[place]) unflushed[place].delete(e)
        mine[place] = mine[place].filter(live)
      }
      const flushed = [...new Set(LIBRARIES.flatMap((place) => mine[place]))]
      await during(flushed, async () => {
        await Promise.all(
          LIBRARIES.map(async (place) => {
            const listed = mine[place].filter((e) => e.places.has(place))
            const touched = listed.filter((e) => touches(e, place))
            const byJob = touched.filter((e) => place === 'engine' && e.engineStep)
            const byFlush = touched.filter((e) => !byJob.includes(e))
            const result = outcome[place]
            if (result === 'later') return
            for (const e of listed)
              if (!touched.includes(e) || (result === 'off' && byFlush.includes(e)))
                replace(e, null, place)
            if (result === 'queued') for (const e of byFlush) hold(place, e)
            await Promise.all([
              check(place, byJob, null),
              result === 'off' || result === 'queued' ? undefined : check(place, byFlush, result),
            ])
          }),
        )
        for (const e of flushed) emit(e)
      })
    },

    // stillQueued: the apply was refused and left the repoints in the queue, so the tracks
    // held on them are re-checked when a later apply writes them.
    async afterQueueApplied(
      place: Library,
      result: QueueApplied,
      stillQueued = false,
    ): Promise<void> {
      const held = [...awaiting[place]]
      await during(held, async () => {
        await check(place, held, result)
        if (result === 'failed' && stillQueued) for (const e of held) awaiting[place].add(e)
        for (const e of held) emit(e)
      })
    },

    // An apply that found the program open: the tracks a retry left checking wait for it to
    // close.
    async afterQueueWaits(place: Library): Promise<void> {
      const held = [...awaiting[place]].filter((e) => stateOf(e, place) === 'checking')
      for (const e of held) {
        replace(e, pending(place), place)
        emit(e)
      }
    },

    // The worst place decides: a file or Music entry that does not add up is converted again
    // while its source is there to convert from, and only re-read once the source is gone
    // (the only copy left would be the suspect file). A library is handed its repoint again
    // and re-checked when the queue applies; a place that could not be read is read again.
    async retry(trackId: string): Promise<'rerun-job' | 'rechecked'> {
      const e = entries.get(trackId)
      if (!e) throw errorWithKey('verifyUnknownTrack')
      return during([e], () => recheck(e))
    },

    // The DJ added the track to Music by hand after its check: Music is read again for the
    // entry that add made. A track whose job never went to Music has nothing to re-read.
    async musicAdded(trackId: string, pid: string): Promise<void> {
      const e = entries.get(trackId)
      if (!e?.music) return
      const music = { ...e.music, pid }
      e.music = music
      await during([e], async () => {
        replace(e, await deps.readMusic(music), 'appleMusic')
        emit(e)
      })
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
      // Only a library still on the old file is handed its repoint again: one that already
      // names the file would move its cues a second time.
      if (stillOld(e, place) || neverWritten(e, place)) {
        hold(place, e)
        if (!deps.requeue(place, e) && stateOf(e, place) === 'pending')
          replace(e, checking(place), place)
      } else if (state === 'unreadable' || state === 'mismatch') await check(place, [e], null)
    }
    emit(e)
    return 'rechecked'
  }
}
