import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppleMusicTrackMeta,
  LibraryTagUpdate,
  PlaylistSource,
  ReviewRawFields,
  SessionEdit,
  SourcePlaylistEntry,
  SourcePreview,
  TrackMetadata,
} from '../../../shared/types'
import { fillFromAppleMusic } from '../lib/appleMusicFill'
import { createPriorityLimit } from '../lib/concurrency'
import { trackSignature, withSignatureCover, withSignatureMeta } from '../lib/dirty'
import { parseFileName } from '../lib/filename'
import { newTrackPaths } from '../lib/newTracks'
import { mergeReadMeta } from '../lib/readMerge'
import { withReviewedFields } from '../lib/reviewedFields'
import { searchFromTags } from '../lib/search'
import { deselect, type Selection } from '../lib/selection'
import { hasStagedEdits } from '../lib/sessionEdits'
import type { TrackItem } from '../types'
import { clearMaximizedSection } from './useEditorSections'
import { useStableCallback } from './useStableCallback'

const AUDIO_EXT = /\.(wav|flac|aif|aiff|mp3|m4a|mp4|aac|ogg|oga|opus)$/i

// Cap on tracks read in parallel when files are dropped: each spawns taglib +
// ffprobe, so an unbounded drop of a full crate would flood the main process.
const READ_CONCURRENCY = 6

// How long finished metadata reads wait to be written to the crate together. Short enough
// that a row's tags land with no visible lag, long enough to fold a burst of replies.
const META_FLUSH_MS = 50

// How long the "N new tracks" prompt stays up before dismissing itself. Long enough to
// read and hit Load, short enough that an ignored prompt gets out of the way; timing out
// declines the offer, exactly like the ✕. Exported so the toast's countdown bar matches.
export const NEW_TRACKS_PROMPT_TIMEOUT_MS = 6_000

function newTrack(path: string): TrackItem {
  const { fileName, artist, title, query } = parseFileName(path)
  return {
    id: crypto.randomUUID(),
    inputPath: path,
    fileName,
    query,
    status: 'idle',
    listLabel: title || fileName,
    meta: {
      title,
      artist,
      album: '',
      albumArtist: '',
      year: '',
      genre: '',
      grouping: '',
      comment: '',
      trackNumber: '',
      discNumber: '',
      bpm: '',
      key: '',
      publisher: '',
      catalogNumber: '',
      remixArtist: '',
    },
  }
}

function listedIn(listed: ReadonlySet<string>, t: TrackItem): boolean {
  return (
    listed.has(t.inputPath.normalize('NFC')) ||
    (!!t.outputPath && listed.has(t.outputPath.normalize('NFC'))) ||
    (t.movedFrom ?? []).some((p) => listed.has(p.normalize('NFC')))
  )
}

interface Params {
  // The library owns the selection consequences of its operations (deselect on remove,
  // id swap on start-over, first-track pick on import) through App's setter.
  setSelection: React.Dispatch<React.SetStateAction<Selection>>
  // Per-track registry cleanup, kept in App where the registries live: forget fires
  // when a row is rebuilt in place (start over), remove when a row leaves the list,
  // clear when the whole list does.
  onForget: (id: string) => void
  // The whole departing batch at once, not one call per row: freeing a shared cover blob
  // is a decision about the batch as a whole (see revokeDisplacedCovers). A lone removal
  // is simply a batch of one.
  onRemove: (tracks: TrackItem[]) => void
  onClear: (tracks: TrackItem[]) => void
  // Fired once a fresh import's metadata read lands, with the read-merged track —
  // App gates the auto-match opt-in on it.
  onMetaLoaded: (track: TrackItem) => void
  // How many dropped/picked audio files were already in the list and skipped, so App
  // can tell the user instead of the silent no-op a re-dragged folder used to be.
  onDuplicatesSkipped: (count: number) => void
  // Fired when a user-initiated drop/pick carried no audio at all, so App can say so
  // instead of the drop being a total no-op. The same silence also covered a failed
  // stat() — a denied permission, a dropped network mount, a broken alias all collapse
  // to zero paths in expand.ts — leaving "there is nothing here" indistinguishable from
  // "I could not read it".
  onNoAudioFound: () => void
  // How many files in a finished import batch failed their metadata read, so App can
  // say so — those rows silently showing only file-name data used to read as "this
  // file has no tags" when the real tags were just unreadable.
  onMetaReadFailed: (count: number) => void
  // Fired once per addPaths call with the deduped batch of genuinely new paths, right
  // after they're known and before their metadata reads resolve — App's hook for seeding
  // the disk-cached quality/clipping verdicts (seedCachedAnalyses) in one round trip so
  // the list shows them immediately instead of waiting on each track's own lazy probe.
  onPathsAdded?: (paths: string[]) => void
  filesOpen?: boolean
}

// Tracks that appeared in a watched folder after it was loaded, waiting on the user to
// confirm. root is the folder they live under (its basename labels the prompt); paths are
// the not-yet-loaded audio files. null when there is nothing to offer.
interface PendingNew {
  root: string
  paths: string[]
}

interface TrackLibrary {
  tracks: TrackItem[]
  pendingNew: PendingNew | null
  loadPending: () => void
  dismissPending: () => void
  // Cumulative metadata-read progress across overlapping drops (null when idle), so the top
  // bar can fill determinately and the toolbar can show a "212/319" counter instead of an
  // opaque animation while a big crate's tags load.
  importProgress: { done: number; total: number } | null
  cancelImport: () => void
  setTracks: React.Dispatch<React.SetStateAction<TrackItem[]>>
  // Live view for long-lived callbacks (sweeps, batch loops) that must read each
  // track at the moment of use rather than from a render snapshot.
  tracksRef: { readonly current: TrackItem[] }
  // `streamed` marks a batch the expand walk emitted, as opposed to the awaited call the
  // user's action made — it changes what counts as a duplicate worth reporting.
  addPaths: (
    paths: string[],
    restore?: Record<string, SessionEdit>,
    streamed?: boolean,
    toFiles?: boolean,
  ) => Promise<void>
  // Stages a reopen's saved edits before its paths are expanded. Measured in the app: the
  // walk streams the paths first, so by the time addPaths' own restore argument arrives
  // every row already exists and none is "fresh" — a reopened session restored one of four
  // saved tracks. Same fix the playlist import needed for its own seed.
  seedRestoredEdits: (edits: Record<string, SessionEdit>) => void
  prioritizeReads: (ids: string[]) => void
  openSourcePlaylist: (
    entries: SourcePlaylistEntry[],
    source: PlaylistSource,
    options?: { fillLoaded?: boolean },
  ) => Promise<number>
  updateTrack: (id: string, patch: Partial<TrackItem>) => void
  mapTracks: (patch: (t: TrackItem) => TrackItem) => void
  updateTracksMeta: (ids: string[], metaPatch: Partial<TrackMetadata>) => void
  patchTracks: (ids: string[], patch: Partial<TrackItem>) => void
  clearExtrasTracks: (ids: string[]) => void
  deriveTracks: (patches: { id: string; meta: Partial<TrackMetadata> }[]) => void
  startOverTrack: (track: TrackItem) => void
  // Reads the file again for a row whose import-time read failed, keeping whatever the
  // user typed on the row meanwhile (the read fills only the fields still at their
  // name-parsed value) and clearing the failed mark. Resolves true once the row holds the
  // file's tags; false leaves the mark in place, and the conversion refuses the row.
  rereadTrackMeta: (id: string) => Promise<boolean>
  completeTrackMeta: (id: string) => Promise<void>
  // Re-reads the file after an in-place export rewrote it, so the row stops describing
  // bytes that no longer exist. Only the fields the row renders — everything the user
  // staged in the editor is left alone.
  refreshTrackFromDisk: (id: string, path: string) => Promise<void>
  // The review rewrote these fields on the file: rows of that file take the new values
  // and their disk snapshot moves with them, so the fix is not left looking like an edit.
  patchReviewedFields: (path: string, fields: LibraryTagUpdate['fields']) => void
  removeTrack: (id: string, everywhere?: boolean) => void
  removeTracks: (ids: string[], everywhere?: boolean) => void
  clearTracks: () => void
}

// The track collection: import pipeline (drop/picker/OS hand-over, instant rows with
// async metadata reads), the write paths every edit goes through, and removal.
export function useTrackLibrary({
  setSelection,
  onForget,
  onRemove,
  onClear,
  onMetaLoaded,
  onDuplicatesSkipped,
  onNoAudioFound,
  onMetaReadFailed,
  onPathsAdded,
  filesOpen = true,
}: Params): TrackLibrary {
  const filesOpenRef = useRef(filesOpen)
  filesOpenRef.current = filesOpen
  const listedBySource = useRef(new Set<string>())
  const [tracks, setTracks] = useState<TrackItem[]>([])
  const tracksRef = useRef<TrackItem[]>([])
  tracksRef.current = tracks
  // Import progress, accumulated across overlapping drops via refs (the React state is just
  // the render mirror): each drop bumps the total, each finished read bumps done, and the
  // pair resets to null once everything in flight has landed — like the auto-match sweep.
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)
  // Bumped by every cancel. Read inside the read loop like the analyze and auto-match
  // sweeps read their flags: importing is the longest operation in the app (thousands of
  // files on a NAS, one tag read each) and was the only one with no way out. Each import
  // keeps the value it started under, so the next import cannot wake a cancelled queue
  // back up, and a cancelled read landing late cannot count toward the next progress.
  const importGeneration = useRef(0)
  const readSlot = useRef(createPriorityLimit(READ_CONCURRENCY))
  // Tracks the watcher found in a loaded folder, parked until the user accepts the prompt.
  const [pendingNew, setPendingNew] = useState<PendingNew | null>(null)
  // Paths the user said no to: removed from the crate (row X or the multi-delete button) or
  // offered by the watcher and declined (✕, or the prompt timing out). Their files are still
  // on disk, so without this the watcher's next report — the safety poll fires every minute
  // whether or not anything changed — would flag each one as "new" again and again.
  const ignoredPaths = useRef(new Set<string>())
  // Paths added by the in-flight walk's own streamed batches, awaiting the final expandPaths
  // result that repeats them. They are Surco's plumbing, not a user duplicate, so the skip
  // notice discounts them — and consumes the set, one import at a time. See addPaths.
  const streamedPaths = useRef(new Set<string>())
  const importDone = useRef(0)
  const importTotal = useRef(0)
  // Failed metadata reads in the in-flight batch, reported once when it settles so a
  // 300-file drop yields one "couldn't read N" notice rather than a toast per file.
  const importFailed = useRef(new Set<string>())
  // removeTrack must keep a stable identity (memoized rows depend on it) while App's
  // registry-cleanup callback is recreated every render; the ref bridges the two.
  const onRemoveRef = useRef(onRemove)
  onRemoveRef.current = onRemove
  // Same bridge for the read callback: an import's workers outlive the render that
  // started them, and App's callback gates on the settings of the render it came from.
  const onMetaLoadedRef = useRef(onMetaLoaded)
  onMetaLoadedRef.current = onMetaLoaded

  // Staged edits from the reopened session, waiting for their track's metadata read
  // to land so the restore can be overlaid on top of the fresh file read. Keyed by
  // source path and consumed (once) by loadTrackMeta.
  const restoredEdits = useRef(new Map<string, SessionEdit>())

  // Coalesces finished metadata reads into a single array rewrite. Each read files a
  // per-row applier keyed by track id here instead of calling setTracks itself: a big
  // drop resolves many reads in the same tick, and React runs every queued updater to
  // fold the state — so per-file setTracks(prev.map) is N maps over the N-row array, i.e.
  // N² element copies (plus N discarded intermediate arrays) that froze the list while it
  // loaded. Buffering the appliers and flushing them in one prev.map keeps that work linear
  // in the file count. The applier still receives each row's live object, so a field the
  // user typed into mid-read keeps winning through mergeReadMeta exactly as before.
  // What the Music database knows about each imported path, consumed by the read below.
  // It rides here rather than on the row because the fill has to land ON the file's own
  // tags — applied to the row instead, the async read would arrive later and overwrite it.
  const appleMusicMeta = useRef(new Map<string, AppleMusicTrackMeta>())
  // Fields to stamp on a row the moment it is created, keyed by path. A ref rather than an
  // argument because the rows an import creates do not come from its own addPaths call:
  // onExpandedBatch fires with the same paths first (see the streaming comment below), and
  // the awaited call then dedupes against rows that already exist. A seed passed only to
  // that late call reached no row at all — measured in the app, imported tracks arrived
  // with no Apple Music identity and no format protection.
  const pendingSeed = useRef(new Map<string, Partial<TrackItem>>())
  const metaPatchBuffer = useRef(new Map<string, (t: TrackItem) => TrackItem>())
  const metaFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const metaFlushScheduled = useRef(false)
  const lastMetaFlush = useRef(Number.NEGATIVE_INFINITY)
  // The import pill's count rides the same flush: bumped once per finished read, it
  // re-rendered the whole App per file just as the per-file patch did.
  const progressPending = useRef(false)
  // The reads to announce through onMetaLoaded, held until their patch is in tracksRef: the
  // auto-match sweep it feeds reads the row back by id, and before the flush it found the
  // file-name guess, probed with it and then discarded the verdict as stale.
  const loadedPending = useRef<TrackItem[]>([])
  const flushMetaPatches = useCallback((): void => {
    if (metaFlushTimer.current) clearTimeout(metaFlushTimer.current)
    metaFlushTimer.current = null
    metaFlushScheduled.current = false
    lastMetaFlush.current = performance.now()
    if (progressPending.current) {
      progressPending.current = false
      setImportProgress({ done: importDone.current, total: importTotal.current })
    }
    const appliers = metaPatchBuffer.current
    if (appliers.size === 0) return
    metaPatchBuffer.current = new Map()
    // The ref first, eagerly: a caller that awaited the read (rereadTrackMeta before a
    // conversion) re-resolves its row from the ref in the very next microtask, before
    // React has rendered the state below. A copy patched in place rather than a second
    // map: the appliers are pure, so the row is the same either way, and the array work
    // per flush stays one pass (the linear-work test counts map visits).
    const patched = tracksRef.current.slice()
    for (let i = 0; i < patched.length; i++) {
      const applier = appliers.get(patched[i].id)
      if (applier) patched[i] = applier(patched[i])
    }
    tracksRef.current = patched
    setTracks((prev) => prev.map((t) => appliers.get(t.id)?.(t) ?? t))
    const loaded = loadedPending.current
    loadedPending.current = []
    for (const t of loaded) onMetaLoadedRef.current(t)
  }, [])
  // At most one write per window. The first read after a quiet spell flushes in a
  // microtask, so a lone read (or a batch resolving in the same tick) lands as before and
  // settles within the act() that awaited it. Reads landing right after a write wait for
  // the window to close: each IPC reply arrives in its own task, so flushing each one
  // re-rendered the whole App per file while a big import loaded. A caller that awaits its
  // read and then reads the row back (rereadTrackMeta, completeTrackMeta,
  // refreshTrackFromDisk) flushes at once instead.
  const scheduleMetaFlush = useCallback((): void => {
    if (metaFlushScheduled.current) return
    metaFlushScheduled.current = true
    const wait = lastMetaFlush.current + META_FLUSH_MS - performance.now()
    if (wait <= 0) queueMicrotask(flushMetaPatches)
    else metaFlushTimer.current = setTimeout(flushMetaPatches, wait)
  }, [flushMetaPatches])
  const enqueueMetaPatch = useCallback(
    (id: string, applier: (t: TrackItem) => TrackItem): void => {
      // Composed, not replaced: two reads of one row inside the window (an import read and
      // the full read that completes it) must both land.
      const earlier = metaPatchBuffer.current.get(id)
      metaPatchBuffer.current.set(id, earlier ? (t) => applier(earlier(t)) : applier)
      scheduleMetaFlush()
    },
    [scheduleMetaFlush],
  )

  // `streamed` marks the call as one of the folder walk's own progress batches rather than a
  // user-initiated import, which is what tells the skip notice apart from a real re-drop.
  // Staged before the expand so whichever path creates the row — the walk's stream or the
  // awaited call — finds the edit already waiting. See the seedRestoredEdits doc above.
  function seedRestoredEdits(edits: Record<string, SessionEdit>): void {
    for (const [path, edit] of Object.entries(edits)) restoredEdits.current.set(path, edit)
  }

  async function addPaths(
    paths: string[],
    restore?: Record<string, SessionEdit>,
    streamed = false,
    toFiles = true,
  ): Promise<void> {
    // Read the live list, not the render snapshot: the native picker can sit open for
    // a long time, and a file that arrived through the OS meanwhile must still dedupe.
    const existing = new Set(tracksRef.current.map((t) => t.inputPath))
    const alreadyInFiles = new Set(
      tracksRef.current.filter((t) => t.inFiles).map((t) => t.inputPath),
    )
    const audio = paths.filter((p) => AUDIO_EXT.test(p))
    const fresh = audio.filter((p) => !existing.has(p))
    // A user-initiated drop that yielded no audio at all: say so rather than doing nothing
    // visible. Only for real imports — the walk's own progress batches land one per
    // directory, and an artwork-only subfolder inside a crate is normal. The all-duplicates
    // case is excluded on purpose: those paths ARE audio, and the skip notice below covers
    // them; firing both would report one drop twice.
    if (!streamed && paths.length > 0 && audio.length === 0) onNoAudioFound()
    // Only new rows and rows joining Files untouched restore: a path already in the list
    // with edits of its own is a live track whose current state must not be clobbered by a
    // stale saved edit. A reopen seeds its edits through seedRestoredEdits BEFORE
    // expanding, so the streamed rows find them waiting — see the ref's own comment.
    if (restore) {
      for (const path of fresh) {
        const edit = restore[path]
        if (edit) restoredEdits.current.set(path, edit)
      }
    }
    // Already-in-the-list audio files are skipped (re-dragging a folder is common);
    // report the count so App can surface it rather than the old silent no-op. A progress
    // batch never reports: it is Surco's own plumbing, and its paths are also in the final
    // result, so counting there would blame the user for a duplicate they never made — one
    // toast per batch, stacked over the UI on a big crate. The batch instead records what it
    // added, and the final call discounts exactly that before reporting the rest. Consuming
    // the record there keeps each import self-contained, so re-dropping the same folder
    // (which replays the batches too) still reports every path as the duplicate it is.
    if (streamed) {
      for (const path of fresh) streamedPaths.current.add(path)
    } else {
      const selfStreamed = audio.filter((p) => streamedPaths.current.has(p))
      streamedPaths.current = new Set()
      const joining = new Set(
        toFiles ? audio.filter((p) => existing.has(p) && !alreadyInFiles.has(p)) : [],
      )
      const joined = new Map(
        tracksRef.current
          .filter((t) => joining.has(t.inputPath))
          .map((t) => [t.id, joinFiles(t, restore?.[t.inputPath])]),
      )
      if (joined.size > 0)
        mapTracks((t) => {
          const patch = joined.get(t.id)
          return patch ? { ...t, ...patch } : t
        })
      const skipped = audio.filter((p) => alreadyInFiles.has(p)).length - selfStreamed.length
      if (skipped > 0) onDuplicatesSkipped(skipped)
    }
    if (fresh.length === 0) return
    onPathsAdded?.(fresh)
    // Importing a new crate is a context change, not a track step: if a section was blown
    // up to the whole window, leave that view now so the freshly selected track's spectrum
    // doesn't render full-screen behind the editor while it analyzes.
    clearMaximizedSection()
    // Show the rows the instant they're dropped, parsed from the file name, then fill in
    // tags, duration and cover as each file's read resolves. Reading metadata up front used
    // to block the whole drop behind the slowest file — on a cloud/network folder that's
    // seconds of an empty list that looks broken even though the import is running.
    // Consumed here, so whichever call creates the row carries the stamp — and a path
    // re-imported later starts clean rather than inheriting a stale mark.
    const bases = fresh.map((path) => {
      const seeded = pendingSeed.current.get(path)
      pendingSeed.current.delete(path)
      return { ...newTrack(path), loadingMeta: true, ...(toFiles && { inFiles: true }), ...seeded }
    })
    // Publish the new rows to the live view immediately rather than waiting for the render
    // that setTracks schedules. A folder walk pays out batches back-to-back, so two can land
    // in the same tick: React has not repainted between them, tracksRef still holds the crate
    // as it was before the first batch, and the second would re-add every path they share —
    // the duplicated tracks a local (fast) import produced. Everything below counts on bases
    // being exactly what was added, so the dedupe has to settle before it, not inside
    // setTracks; the updater stays a plain append and the render overwrites this with the
    // identical array.
    tracksRef.current = [...tracksRef.current, ...bases]
    setTracks((prev) => [...prev, ...bases])
    // Every import route (drop, picker, Open With, watched folder) funnels through
    // here after dedup, so this is the one bump for the lifetime "loaded" tally.
    window.api.recordStat('imported', bases.length)
    setSelection((s) => (s.anchor ? s : { ids: [bases[0].id], anchor: bases[0].id }))
    importTotal.current += bases.length
    setImportProgress({ done: importDone.current, total: importTotal.current })
    const generation = importGeneration.current
    // The rows this import added that never got their tags read. A cancel drops them:
    // they carry nothing but a filename, and leaving them would put rows in the crate
    // that look like tracks with no metadata. Rows already read are finished work and
    // stay — cancel means "stop working", not "undo".
    const unread = new Set(bases.map((b) => b.id))
    void Promise.all(
      bases.map((base) =>
        readSlot.current.run(base.id, async () => {
          // Checked before the read, not after: the point is to not start the ones still
          // queued behind the handful already in flight.
          if (generation !== importGeneration.current) return
          const present = tracksRef.current.some((t) => t.id === base.id)
          const ok = present ? await loadTrackMeta(base) : true
          unread.delete(base.id)
          if (generation !== importGeneration.current) return
          if (!ok) importFailed.current.add(base.id)
          importDone.current += 1
          if (importDone.current >= importTotal.current) {
            importDone.current = 0
            importTotal.current = 0
            progressPending.current = false
            setImportProgress(null)
            // The import is done: whatever reads are still waiting on the window land with
            // the pill's end, not a moment after it.
            flushMetaPatches()
            const failed = tracksRef.current.filter((t) => importFailed.current.has(t.id)).length
            importFailed.current = new Set()
            if (failed > 0) onMetaReadFailed(failed)
          } else {
            progressPending.current = true
            scheduleMetaFlush()
          }
        }),
      ),
    ).then(() => {
      if (generation === importGeneration.current || unread.size === 0) return
      // Dropped only once every worker has settled, so a row is never removed while its
      // own read is still running and about to patch it.
      const dropped = unread
      tracksRef.current = tracksRef.current.filter((t) => !dropped.has(t.id))
      setTracks((prev) => prev.filter((t) => !dropped.has(t.id)))
    })
  }

  function joinFiles(t: TrackItem, saved: SessionEdit | undefined): Partial<TrackItem> {
    if (!saved) return { inFiles: true }
    if (t.loadingMeta) {
      restoredEdits.current.set(t.inputPath, saved)
      return { inFiles: true }
    }
    restoredEdits.current.delete(t.inputPath)
    if (hasStagedEdits(t) || t.normalize !== undefined || t.declick !== undefined)
      return { inFiles: true }
    return {
      ...restoredPatch(saved),
      ...(!t.embeddedCover && saved.coverUrl && { embeddedCover: saved.coverUrl }),
      meta: saved.meta,
      inFiles: true,
    }
  }

  // The fields of a reopened session's staged edit that overlay the fresh file read.
  // The saved metadata wins over the file's own tags — it is the newer truth the user
  // had staged but not applied when the last session ended.
  function restoredPatch(saved: SessionEdit): Partial<TrackItem> {
    const patch: Partial<TrackItem> = {}
    if (saved.coverUrl || saved.coverRemoved) patch.coverUrl = saved.coverUrl
    if (saved.coverPath) patch.coverPath = saved.coverPath

    // Without these two a reopened row forgets it belongs to a library copy: the convert
    // button offers to ADD a track that is already there (a second copy of the same song),
    // and the conversion stops honouring the source's own format.
    if (saved.musicPersistentId) patch.musicPersistentId = saved.musicPersistentId
    if (saved.fromAppleMusic) patch.fromAppleMusic = true
    if (saved.fromRekordbox) patch.fromRekordbox = true
    if (saved.fromEngine) patch.fromEngine = true
    if (saved.fromTraktor) patch.fromTraktor = true
    if (saved.coverRemoved) patch.coverRemoved = true
    if (saved.metaCleared) patch.metaCleared = true
    if (saved.foreignRemoved) patch.foreignRemoved = saved.foreignRemoved
    if (saved.outputName) patch.outputName = saved.outputName
    if (saved.matched) patch.matched = true
    if (saved.autoMatched) patch.autoMatched = true
    if (saved.matchConfidence !== undefined) patch.matchConfidence = saved.matchConfidence
    if (saved.matchProvider) patch.matchProvider = saved.matchProvider
    if (saved.appliedRelease) patch.appliedRelease = saved.appliedRelease
    if (saved.trim) patch.trim = saved.trim
    if (saved.rekordboxPlaylists) patch.rekordboxPlaylists = saved.rekordboxPlaylists
    if (saved.rekordboxPlaylistsBase) patch.rekordboxPlaylistsBase = saved.rekordboxPlaylistsBase
    if (saved.traktorPlaylists) patch.traktorPlaylists = saved.traktorPlaylists
    if (saved.traktorPlaylistsBase) patch.traktorPlaylistsBase = saved.traktorPlaylistsBase
    if (saved.enginePlaylists) patch.enginePlaylists = saved.enginePlaylists
    if (saved.enginePlaylistsBase) patch.enginePlaylistsBase = saved.enginePlaylistsBase
    if (saved.normalize) patch.normalize = saved.normalize
    if (saved.declick) patch.declick = saved.declick
    return patch
  }

  async function loadTrackMeta(base: TrackItem): Promise<boolean> {
    const path = base.inputPath
    // Consumed exactly once: a later start-over on the same path must rebuild from
    // the file alone, not resurrect the restored edit.
    const saved = restoredEdits.current.get(path)
    restoredEdits.current.delete(path)
    try {
      // The light read leaves the cover out because the library painted it already; a row
      // the library holds no art for needs the file's own, or it shows a placeholder until
      // it is clicked.
      const read = base.sourcePreview?.coverUrl
        ? await window.api.readMetaLight(path)
        : { ...(await window.api.readMeta(path)), partial: false }
      const { tags, duration, cover, foreignTags, failed, reviewRaw } = read
      const s = searchFromTags(parseFileName(path), tags)
      // Whatever Music knows that this file does not. Consumed once, like the restored
      // edit above: a later start-over must rebuild from the file alone.
      const fromMusic = appleMusicMeta.current.get(path)
      appleMusicMeta.current.delete(path)
      const readMeta: TrackMetadata = fillFromAppleMusic(
        {
          ...base.meta,
          ...tags,
          title: s.title,
          artist: s.artist,
        },
        fromMusic ?? {},
      )
      const patch: Partial<TrackItem> = {
        query: s.query,
        queryTyped: false,
        duration: duration ?? undefined,
        foreignTags,
        // The file's own art wins; Music's copy fills the gap for the files that carry
        // none — over half a real library, almost all WAVs, which imported with an empty
        // cover slot even though Music held the picture.
        coverUrl: cover?.thumbUrl ?? fromMusic?.coverUrl,
        ...(cover?.thumbUrl ? {} : { coverPath: fromMusic?.coverPath }),
        // The row reads embeddedCover, the art captured once at import — so Music's copy
        // belongs here too for the files that carry none of their own, or the crate shows
        // a placeholder while the editor shows the cover. The file's own art still wins.
        embeddedCover: cover?.thumbUrl ?? fromMusic?.coverUrl,
        embeddedCoverDims:
          cover && cover.width > 0 ? { w: cover.width, h: cover.height } : undefined,
        listLabel: s.title || base.fileName,
        loadingMeta: false,
        metaPartial: read.partial,
        // The pure read IS the file's state: everything staged on top of this
        // snapshot exists nowhere on disk, which is what the session store persists.
        // Stamped before the restored overlay below, so restored edits keep counting
        // as staged until they are actually converted.
        diskSignature: trackSignature({ meta: readMeta, coverUrl: cover?.thumbUrl }),
      }
      // Only a spelling the row took from the file: a title parsed from the file name or
      // filled from Music is not the file's spelling of anything.
      const rawFields = Object.fromEntries(
        Object.entries(reviewRaw ?? {}).filter(
          ([field, value]) => value.trim() === readMeta[field as keyof ReviewRawFields],
        ),
      )
      if (Object.keys(rawFields).length > 0 && patch.diskSignature)
        patch.reviewRaw = { signature: patch.diskSignature, fields: rawFields }
      if (saved) Object.assign(patch, restoredPatch(saved))
      // The row paints from embeddedCover, so a cover restored from the session has to
      // land there too — otherwise reopening showed the placeholder in the crate while the
      // editor showed the art, for every track whose cover came from the library rather
      // than the file. The file's own art still wins: the row is a view of the file on
      // disk, and this only fills the gap when the file carries none.
      if (!cover?.thumbUrl && saved?.coverUrl) patch.embeddedCover = saved.coverUrl
      // A restored edit replaces the read wholesale (it was itself built on a read of
      // this same file, plus everything the user staged since); the matched flag rides
      // in the patch so the auto-match sweep skips the row instead of overwriting it.
      const finalMeta = saved ? saved.meta : readMeta
      // The row is editable while the read runs, so merge instead of overwriting:
      // a field the user typed into meanwhile keeps the user's value, and the read
      // fills only what was left untouched. Queued into the shared flush rather than
      // written on its own, so a batch of reads costs one array rewrite, not one each.
      loadedPending.current.push({ ...base, ...patch, meta: finalMeta })
      enqueueMetaPatch(base.id, (t) => ({
        ...t,
        ...patch,
        // A read that succeeded clears the mark a failed one left; a degraded read sets
        // it, so the row says so instead of looking like a file with no tags.
        ...(failed ? { metaReadFailed: true } : t.metaReadFailed ? { metaReadFailed: false } : {}),
        meta: mergeReadMeta(base.meta, t.meta, finalMeta),
      }))
      // Reported like a thrown failure so the batch's aggregate notice counts it: the
      // read degraded, whether or not it raised on the way.
      return !failed
    } catch {
      // The row survives on its file-name parse, but flagged: without the mark, an
      // unreadable file is indistinguishable from a file that simply carries no tags.
      // A restored edit still applies — its metadata is better than the name parse,
      // and losing it to a transient read failure is exactly what the store prevents.
      // The disk snapshot is the name-parse state the row fell back to, so edits
      // typed on top of an unreadable file still count as staged.
      const patch: Partial<TrackItem> = {
        loadingMeta: false,
        metaReadFailed: true,
        diskSignature: trackSignature({ meta: base.meta }),
      }
      if (saved) Object.assign(patch, restoredPatch(saved))
      enqueueMetaPatch(base.id, (t) => ({
        ...t,
        ...patch,
        meta: saved ? mergeReadMeta(base.meta, t.meta, saved.meta) : t.meta,
      }))
      return false
    }
  }

  // Right-click "Start over": rebuild the row from the file alone, exactly as if it had
  // just been dropped — re-parse the name, re-read tags/duration/cover, and drop every
  // edit, match and conversion state. The rebuilt track gets a fresh id so the editor
  // remounts and re-seeds its own state (the Discogs search box included) from the new
  // read; the selection swaps to the new id so the row stays open.
  // useStableCallback so this keeps one identity across renders — it's passed straight
  // through to TrackList's memoized rows (see TrackList.tsx), and a plain function
  // declaration here would recreate it on every render of this hook (i.e. every render
  // of App), breaking that memo.
  const startOverTrack = useStableCallback((track: TrackItem): void => {
    const base = {
      ...newTrack(track.inputPath),
      loadingMeta: true,
      sourcePreview: track.sourcePreview,
      inFiles: track.inFiles,
    }
    onForget(track.id)
    setTracks((prev) => prev.map((t) => (t.id === track.id ? base : t)))
    setSelection((s) => ({
      ids: s.ids.map((id) => (id === track.id ? base.id : id)),
      anchor: s.anchor === track.id ? base.id : s.anchor,
    }))
    void loadTrackMeta(base)
  })

  // The base is a fresh name parse of the same path under the row's own id, not the row
  // itself: loadTrackMeta merges the read against that base, so a field the user typed on
  // the flagged row (anything differing from the name parse) keeps the user's value and
  // the read fills the rest.
  const rereadTrackMeta = useStableCallback(async (id: string): Promise<boolean> => {
    const current = tracksRef.current.find((t) => t.id === id)
    if (!current) return false
    const ok = await loadTrackMeta({ ...newTrack(current.inputPath), id: current.id })
    flushMetaPatches()
    return ok
  })

  const completing = useRef(new Map<string, Promise<void>>())
  const completeTrackMeta = useStableCallback((id: string): Promise<void> => {
    const inFlight = completing.current.get(id)
    if (inFlight) return inFlight
    const current = tracksRef.current.find((t) => t.id === id)
    if (!current?.metaPartial) return Promise.resolve()
    const completion = readSlot.current.run(id, () => completeFromFullRead(id, current.inputPath))
    readSlot.current.prioritize([id])
    completing.current.set(id, completion)
    return completion
  })

  async function completeFromFullRead(id: string, path: string): Promise<void> {
    try {
      const read = await window.api.readMeta(path).catch(() => null)
      if (!read || read.failed) return
      const { cover, foreignTags } = read
      enqueueMetaPatch(id, (t) => {
        const adopted = t.coverUrl === undefined && !t.coverRemoved ? cover?.thumbUrl : undefined
        return {
          ...t,
          metaPartial: false,
          foreignTags,
          embeddedCover: cover?.thumbUrl ?? t.embeddedCover,
          embeddedCoverDims:
            cover && cover.width > 0 ? { w: cover.width, h: cover.height } : t.embeddedCoverDims,
          ...(adopted && {
            coverUrl: adopted,
            ...(t.processedSignature && {
              processedSignature: withSignatureCover(t.processedSignature, adopted),
            }),
            ...(t.diskSignature && {
              diskSignature: withSignatureCover(t.diskSignature, adopted),
            }),
          }),
          ...(t.metaCleared &&
            t.foreignRemoved && {
              foreignRemoved: [
                ...new Set([...t.foreignRemoved, ...foreignTags.map((tag) => tag.name)]),
              ],
            }),
        }
      })
      flushMetaPatches()
    } finally {
      completing.current.delete(id)
    }
  }

  // An in-place export rewrote the file this row describes (possibly under a new name),
  // so the row's frozen label and the file's own artwork both went stale. Deliberately
  // not loadTrackMeta: that one merges into meta, consumes the restored-edit overlay and
  // restamps diskSignature — all editor state, none of it ours. A failed read is
  // swallowed and, notably, does not set metaReadFailed: the export that triggered this
  // succeeded, so the file is fine and the row is merely stale.
  //
  // Artwork is re-read into BOTH fields the UI paints from — the list reads
  // embeddedCover, the editor's preview reads coverUrl — because they describe the same
  // bytes. Refreshing only the first left the editor on the pre-conversion image, and the
  // only way out was removing the track and loading it again: the whole collection
  // retouched twice. The staged coverRemoved/metaCleared flags clear here for the same
  // reason: the export they asked for has happened, so leaving them set would make the
  // next export strip a cover the user has since put back.
  const refreshTrackFromDisk = useStableCallback(async (id: string, path: string) => {
    try {
      const { tags, duration, cover } = await window.api.readMeta(path)
      const { fileName } = parseFileName(path)
      const s = searchFromTags(parseFileName(path), tags)
      enqueueMetaPatch(id, (t) => {
        const refreshed: TrackItem = {
          ...t,
          listLabel: s.title || fileName,
          duration: duration ?? undefined,
          embeddedCover: cover?.thumbUrl,
          coverUrl: cover?.thumbUrl,
          embeddedCoverDims:
            cover && cover.width > 0 ? { w: cover.width, h: cover.height } : undefined,
          coverRemoved: false,
          metaCleared: false,
        }
        const before = trackSignature(t)
        const after = trackSignature(refreshed)
        return {
          ...refreshed,
          ...(t.processedSignature === before && { processedSignature: after }),
          ...(t.diskSignature === before && { diskSignature: after }),
        }
      })
      flushMetaPatches()
    } catch {
      // Cosmetic: the row keeps the values it already had.
    }
  })

  const patchReviewedFields = useCallback(
    (path: string, fields: LibraryTagUpdate['fields']): void =>
      setTracks((prev) =>
        prev.map((t) => (t.inputPath === path ? withReviewedFields(t, fields) : t)),
      ),
    [],
  )

  const addPathsRef = useRef(addPaths)
  addPathsRef.current = addPaths

  // The folder walk reports its audio files as it finds them, so rows appear during a slow
  // (network) import instead of only when the whole tree has been walked — a 560-folder SMB
  // crate takes ~20s to walk but yields its first files after ~1s. Subscribed here rather
  // than at each call site so every import route (drop, picker, Open With) streams alike.
  // The batches repeat paths the awaited expandPaths returns too; addPaths dedupes against
  // the live crate, so the late full result adds only what streaming had not already shown.
  // Flagged as streamed so that final pass recognises the repeats as self-inflicted instead
  // of reporting them to the user as skipped duplicates.
  useEffect(
    () => window.api.onExpandedBatch((paths) => void addPathsRef.current(paths, undefined, true)),
    [],
  )

  // The main process watches the folders a crate was loaded from and reports each one's
  // current audio list when it changes. Diff against the live crate (tracksRef, not a render
  // snapshot, since a watch can fire long after mount) and park anything genuinely new for
  // the user to accept. A folder that fires with nothing new clears any stale prompt.
  useEffect(() => {
    return window.api.onFoldersChanged((root, files) => {
      // An empty crate has no loaded folder to grow, so there is nothing to diff against —
      // every file would look "new". This happens on macOS, where closing the window keeps
      // the app (and its watches) alive: a watch from a prior session can fire against the
      // reopened window's empty list. Drop the event and release the orphaned watch.
      if (!tracksRef.current.some((t) => t.inFiles)) {
        void window.api.unwatchFolders()
        return
      }
      // Outputs count as loaded too: converting into (or inside) the watched folder
      // must not offer Surco's own conversions back as "new tracks".
      const fresh = newTrackPaths(
        files,
        tracksRef.current.flatMap((t) => [
          ...(t.inFiles ? [t.inputPath] : []),
          ...(t.outputPath ? [t.outputPath] : []),
        ]),
      ).filter((p) => !ignoredPaths.current.has(p))
      setPendingNew((prev) => {
        if (fresh.length === 0) return prev?.root === root ? null : prev
        // Union with an outstanding prompt for the same folder so a second copy-in adds to
        // the count instead of replacing it; a different folder takes over the prompt.
        const merged = prev?.root === root ? Array.from(new Set([...prev.paths, ...fresh])) : fresh
        // A poll that reports the same still-unloaded files must keep the object identity:
        // the prompt's auto-dismiss timer restarts when pendingNew changes, and a rebuilt
        // twin every minute would keep the toast alive forever.
        if (prev && prev.root === root && merged.length === prev.paths.length) return prev
        return { root, paths: merged }
      })
    })
  }, [])

  const loadPending = useCallback((): void => {
    setPendingNew((p) => {
      if (p) void addPathsRef.current(p.paths)
      return null
    })
  }, [])

  // Declining is remembered: the files stay on disk, so a forgotten offer would come
  // straight back on the watcher's next report. Dragging a declined file in by hand
  // still works — addPaths never consults the ignore set.
  const dismissPending = useCallback((): void => {
    setPendingNew((p) => {
      if (p) for (const path of p.paths) ignoredPaths.current.add(path)
      return null
    })
  }, [])

  // A playlist opened from a source is browsing, not importing: the files go through the
  // same add path as a drop so every filter and analysis behaves alike, but stay out of
  // Files, and only the ones not already in the collection are passed on. That keeps a
  // track loaded from Files or another playlist with its edits, and keeps addPaths from
  // reporting it as a skipped duplicate — going back to a playlist is not something the
  // user did twice.
  //
  // The rows go in at once, without waiting for the disk; expandPaths then stats them in
  // the background and the rows whose file is not there are removed. Resolves how many of
  // the playlist's files are not on disk: the paths expandPaths drops are that set, without
  // a second stat per row (a network crate pays ~340 ms per 100 files for it).
  async function openSourcePlaylist(
    entries: SourcePlaylistEntry[],
    source: PlaylistSource,
    { fillLoaded = false }: { fillLoaded?: boolean } = {},
  ): Promise<number> {
    // Compared composed: the NAS stores names decomposed while a drop is composed, and one
    // file under both spellings must stay the one row that holds the user's edits. Outputs
    // count as loaded too, as for the folder watcher: a conversion that is not in place
    // repoints the rekordbox row at the output, and the next re-read must not offer it
    // back as a new, unconverted track.
    const same = (p: string): string => p.normalize('NFC')
    const loadedNow = (): Set<string> =>
      new Set(
        tracksRef.current.flatMap((t) => [
          same(t.inputPath),
          ...(t.outputPath ? [same(t.outputPath)] : []),
          ...(t.movedFrom ?? []).map(same),
        ]),
      )
    const loaded = loadedNow()
    for (const e of entries) if (e.path && !e.separator) listedBySource.current.add(same(e.path))
    // The library behind the rows, for the ones that point at the file by path: rows it
    // lists keep their file name, and their preview follows what the library now holds.
    const libraryFlag =
      source === 'rekordbox' ? 'fromRekordbox' : source === 'traktor' ? 'fromTraktor' : null
    if (libraryFlag) {
      const previewOf = new Map(
        entries.flatMap((e) =>
          e.path && !e.separator && e.preview ? [[same(e.path), e.preview] as const] : [],
        ),
      )
      const nextPreview = (t: TrackItem): SourcePreview | undefined =>
        previewOf.get(same(t.inputPath)) ??
        (t.outputPath ? previewOf.get(same(t.outputPath)) : undefined)
      const stale = new Set(
        tracksRef.current
          .filter((t) => {
            const next = nextPreview(t)
            return next !== undefined && JSON.stringify(next) !== JSON.stringify(t.sourcePreview)
          })
          .map((t) => t.id),
      )
      if (stale.size > 0)
        mapTracks((t) => (stale.has(t.id) ? { ...t, sourcePreview: nextPreview(t) } : t))
      const listed = new Set(entries.flatMap((e) => (e.path && !e.separator ? [same(e.path)] : [])))
      const unmarked = new Set(
        tracksRef.current.filter((t) => !t[libraryFlag] && listedIn(listed, t)).map((t) => t.id),
      )
      if (unmarked.size > 0)
        mapTracks((t) => (unmarked.has(t.id) ? { ...t, [libraryFlag]: true } : t))
    }
    const fresh = entries.filter(
      (e): e is SourcePlaylistEntry & { path: string } =>
        !e.separator && e.path !== null && !loaded.has(same(e.path)),
    )
    // A row loaded before its rekordbox playlist was opened gets the BPM, key and stars the
    // entry holds, as a fresh one does: only its empty fields, so what it holds wins, and as
    // part of what was read (both snapshots take it), so it is not an edit to convert. Once
    // per opening (the caller says which): every edit re-reads the playlist, and a gap the
    // user cleared must not come back on the next reorder. Rows still reading their tags
    // are left to that read.
    if (source === 'rekordbox' && fillLoaded) {
      const fromEntry = new Map(
        entries.flatMap((e) => (e.path && !e.separator ? [[same(e.path), e.meta] as const] : [])),
      )
      const gaps = (t: TrackItem) => {
        const from = fromEntry.get(same(t.inputPath))
        return (meta: TrackMetadata): TrackMetadata =>
          from
            ? fillFromAppleMusic(meta, { bpm: from.bpm, key: from.key, rating: from.rating })
            : meta
      }
      const touched = new Set(
        tracksRef.current
          .filter((t) => !t.loadingMeta && gaps(t)(t.meta) !== t.meta)
          .map((t) => t.id),
      )
      if (touched.size > 0)
        mapTracks((t) => {
          if (!touched.has(t.id)) return t
          const fill = gaps(t)
          return {
            ...t,
            meta: fill(t.meta),
            ...(t.diskSignature && { diskSignature: withSignatureMeta(t.diskSignature, fill) }),
            ...(t.processedSignature && {
              processedSignature: withSignatureMeta(t.processedSignature, fill),
            }),
          }
        })
    }
    if (fresh.length === 0) return 0
    // Staged BEFORE adding: the rows created below must find the stamp waiting.
    for (const e of fresh) {
      appleMusicMeta.current.set(e.path, e.meta)
      if (source === 'appleMusic') {
        pendingSeed.current.set(e.path, {
          fromAppleMusic: true,
          ...(e.musicPersistentId ? { musicPersistentId: e.musicPersistentId } : {}),
        })
      }
      if (source === 'rekordbox')
        pendingSeed.current.set(e.path, {
          fromRekordbox: true,
          ...(e.preview && { sourcePreview: e.preview }),
        })
      if (source === 'engine')
        pendingSeed.current.set(e.path, {
          fromEngine: true,
          ...(e.preview && { sourcePreview: e.preview }),
        })
      if (source === 'traktor')
        pendingSeed.current.set(e.path, {
          fromTraktor: true,
          ...(e.preview && { sourcePreview: e.preview }),
        })
    }
    const freshPaths = [...new Map(fresh.map((e) => [same(e.path), e.path])).values()]
    await addPaths(freshPaths, undefined, false, false)
    const onDisk = new Set((await window.api.expandPaths(freshPaths)).map(same))
    const gone = new Set(freshPaths.filter((p) => !onDisk.has(same(p))).map(same))
    // A staged path the disk lacks may never have been consumed by a row, and would leak
    // into a later unrelated load of that same file.
    for (const e of fresh) {
      if (!gone.has(same(e.path))) continue
      appleMusicMeta.current.delete(e.path)
      pendingSeed.current.delete(e.path)
    }
    const goneRows = tracksRef.current.filter((t) => gone.has(same(t.inputPath))).map((t) => t.id)
    for (const p of gone) listedBySource.current.delete(p)
    if (goneRows.length > 0) {
      removeTracks(goneRows)
      const added = new Set(freshPaths.map(same))
      const firstKept = tracksRef.current.find(
        (t) => added.has(same(t.inputPath)) && !gone.has(same(t.inputPath)),
      )
      if (firstKept)
        setSelection((s) => (s.anchor ? s : { ids: [firstKept.id], anchor: firstKept.id }))
    }
    return gone.size
  }

  // Publishes to the live crate as well as to state, for the same reason the import
  // batches do above: a caller that patches a track and then acts on it in the same tick
  // reads tracksRef, which the render-time assignment does not refresh until React
  // repaints. The replacement flow does exactly that — it stamps the copy to supersede and
  // converts immediately — and without this the conversion ran against the unstamped
  // track, adding a second Apple Music entry and leaving rekordbox on the old file.
  const updateTrack = useCallback((id: string, patch: Partial<TrackItem>): void => {
    tracksRef.current = tracksRef.current.map((t) => (t.id === id ? { ...t, ...patch } : t))
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  // The same ref-then-state publish as updateTrack, for a patch that depends on each row.
  const mapTracks = useCallback((patch: (t: TrackItem) => TrackItem): void => {
    tracksRef.current = tracksRef.current.map(patch)
    setTracks((prev) => prev.map(patch))
  }, [])

  // Writes a shared-field edit (or a dropped cover) onto every selected track at once —
  // the multi-select write path behind the editor's common-field form.
  // Through mapTracks like the rest: ⌘⏎ right after the edit converts from tracksRef in
  // the same tick, and the first rows went out with the value the DJ had just replaced.
  const updateTracksMeta = useCallback(
    (ids: string[], metaPatch: Partial<TrackMetadata>): void => {
      const targets = new Set(ids)
      mapTracks((t) => (targets.has(t.id) ? { ...t, meta: { ...t.meta, ...metaPatch } } : t))
    },
    [mapTracks],
  )

  const patchTracks = useCallback(
    (ids: string[], patch: Partial<TrackItem>): void => {
      const targets = new Set(ids)
      mapTracks((t) => (targets.has(t.id) ? { ...t, ...patch } : t))
    },
    [mapTracks],
  )

  // Bulk "clear everything": unlike patchTracks' flat patch, foreignRemoved must be
  // each track's OWN foreign tag names, so this reads t.foreignTags per row instead
  // of taking a shared patch.
  const clearExtrasTracks = useCallback(
    (ids: string[]): void => {
      const targets = new Set(ids)
      mapTracks((t) =>
        targets.has(t.id)
          ? {
              ...t,
              coverRemoved: true,
              // Off the preview as well as off the next export, matching the single-track
              // clear: a staged removal that still shows the artwork reads as a no-op.
              coverUrl: undefined,
              metaCleared: true,
              foreignRemoved: (t.foreignTags ?? []).map((tag) => tag.name),
            }
          : t,
      )
    },
    [mapTracks],
  )

  // Merges each track's own filename-derived tags into its metadata (one patch per id),
  // leaving fields the pattern didn't match untouched.
  const deriveTracks = useCallback(
    (patches: { id: string; meta: Partial<TrackMetadata> }[]): void => {
      const byId = new Map(patches.map((p) => [p.id, p.meta]))
      mapTracks((t) => (byId.has(t.id) ? { ...t, meta: { ...t.meta, ...byId.get(t.id) } } : t))
    },
    [mapTracks],
  )

  // Stable identity so the memoized TrackRow only re-renders the row that
  // changed. The functional update deselects iff the removed track was selected,
  // which is what the explicit selectedId check did before.
  const removeTrack = useCallback(
    (id: string, everywhere = false): void => {
      const removed = tracksRef.current.find((t) => t.id === id)
      const stays =
        !everywhere &&
        !!removed &&
        filesOpenRef.current &&
        listedIn(listedBySource.current, removed)
      setTracks((prev) =>
        stays
          ? prev.map((t) => (t.id === id ? { ...t, inFiles: false } : t))
          : prev.filter((t) => t.id !== id),
      )
      setSelection((s) => deselect(s, id))
      if (removed) {
        ignoredPaths.current.add(removed.inputPath)
        if (!stays) onRemoveRef.current([removed])
      }
    },
    [setSelection],
  )

  // Drops a subset of rows from the list (the selection, or the filtered-visible set) —
  // the "empty" action when a format filter or selection is active, so the hidden
  // FLAC/WAV rows survive. Unlike clearTracks this keeps the folder watcher: tracks
  // remain, so a later added file should still show up.
  const removeTracks = useCallback(
    (ids: string[], everywhere = false): void => {
      const drop = new Set(ids)
      const leaving = tracksRef.current.filter((t) => drop.has(t.id))
      const stays = new Set(
        !everywhere && filesOpenRef.current
          ? leaving.filter((t) => listedIn(listedBySource.current, t)).map((t) => t.id)
          : [],
      )
      const removed = leaving.filter((t) => !stays.has(t.id))
      setTracks((prev) =>
        prev.flatMap((t) =>
          stays.has(t.id) ? [{ ...t, inFiles: false }] : drop.has(t.id) ? [] : [t],
        ),
      )
      setSelection((s) => ({
        ids: s.ids.filter((id) => !drop.has(id)),
        anchor: s.anchor && drop.has(s.anchor) ? null : s.anchor,
      }))
      for (const track of leaving) ignoredPaths.current.add(track.inputPath)
      onRemoveRef.current(removed)
    },
    [setSelection],
  )

  function clearTracks(): void {
    const cleared = tracksRef.current
    // An import still reading is reading for a crate that no longer exists: without
    // this the pill kept counting toward a total whose rows had just been emptied out.
    cancelImport()
    setPendingNew(null)
    // Emptying the list is a context change like an import: drop any full-window maximized
    // view now, so it can't linger on the store and re-open over the next crate's still-
    // analyzing spectrum. Belt-and-braces with the clear in addPaths.
    clearMaximizedSection()
    // Stop watching the emptied crate's folders; the next folder load rebuilds the watcher.
    void window.api.unwatchFolders()
    if (filesOpenRef.current && cleared.some((t) => listedIn(listedBySource.current, t))) {
      removeTracks(cleared.map((t) => t.id))
      return
    }
    setTracks([])
    setSelection({ ids: [], anchor: null })
    ignoredPaths.current.clear()
    onClear(cleared)
  }

  const prioritizeReads = useCallback((ids: string[]): void => readSlot.current.prioritize(ids), [])

  // Stops an import mid-flight: the reads already running finish (their results are
  // worth keeping), nothing further is picked off the queue, and the rows that never
  // got read are dropped by the settle handler in addPaths.
  function cancelImport(): void {
    importGeneration.current += 1
    importDone.current = 0
    importTotal.current = 0
    importFailed.current = new Set()
    progressPending.current = false
    setImportProgress(null)
  }

  return {
    tracks,
    pendingNew,
    loadPending,
    dismissPending,
    importProgress,
    cancelImport,
    setTracks,
    tracksRef,
    addPaths,
    seedRestoredEdits,
    prioritizeReads,
    openSourcePlaylist,
    updateTrack,
    mapTracks,
    updateTracksMeta,
    patchTracks,
    clearExtrasTracks,
    deriveTracks,
    startOverTrack,
    rereadTrackMeta,
    completeTrackMeta,
    refreshTrackFromDisk,
    patchReviewedFields,
    removeTrack,
    removeTracks,
    clearTracks,
  }
}
