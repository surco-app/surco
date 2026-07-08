import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionEdit, TrackMetadata } from '../../../shared/types'
import { mapWithConcurrency } from '../lib/concurrency'
import { parseFileName } from '../lib/filename'
import { newTrackPaths } from '../lib/newTracks'
import { mergeReadMeta } from '../lib/readMerge'
import { searchFromTags } from '../lib/search'
import { deselect, type Selection } from '../lib/selection'
import type { TrackItem } from '../types'

const AUDIO_EXT = /\.(wav|flac|aif|aiff|mp3|m4a|mp4|aac|ogg|oga|opus)$/i

// Cap on tracks read in parallel when files are dropped: each spawns taglib +
// ffprobe, so an unbounded drop of a full crate would flood the main process.
const READ_CONCURRENCY = 6

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
      albumArtist: artist,
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

interface Params {
  // The library owns the selection consequences of its operations (deselect on remove,
  // id swap on start-over, first-track pick on import) through App's setter.
  setSelection: React.Dispatch<React.SetStateAction<Selection>>
  // Per-track registry cleanup, kept in App where the registries live: forget fires
  // when a row is rebuilt in place (start over), remove when a row leaves the list,
  // clear when the whole list does.
  onForget: (id: string) => void
  onRemove: (track: TrackItem) => void
  onClear: (tracks: TrackItem[]) => void
  // Fired once a fresh import's metadata read lands, with the read-merged track —
  // App gates the auto-match opt-in on it.
  onMetaLoaded: (track: TrackItem) => void
  // How many dropped/picked audio files were already in the list and skipped, so App
  // can tell the user instead of the silent no-op a re-dragged folder used to be.
  onDuplicatesSkipped: (count: number) => void
  // How many files in a finished import batch failed their metadata read, so App can
  // say so — those rows silently showing only file-name data used to read as "this
  // file has no tags" when the real tags were just unreadable.
  onMetaReadFailed: (count: number) => void
}

// Tracks that appeared in a watched folder after it was loaded, waiting on the user to
// confirm. root is the folder they live under (its basename labels the prompt); paths are
// the not-yet-loaded audio files. null when there is nothing to offer.
export interface PendingNew {
  root: string
  paths: string[]
}

export interface TrackLibrary {
  tracks: TrackItem[]
  pendingNew: PendingNew | null
  loadPending: () => void
  dismissPending: () => void
  // Cumulative metadata-read progress across overlapping drops (null when idle), so the top
  // bar can fill determinately and the toolbar can show a "212/319" counter instead of an
  // opaque animation while a big crate's tags load.
  importProgress: { done: number; total: number } | null
  setTracks: React.Dispatch<React.SetStateAction<TrackItem[]>>
  // Live view for long-lived callbacks (sweeps, batch loops) that must read each
  // track at the moment of use rather than from a render snapshot.
  tracksRef: { readonly current: TrackItem[] }
  addPaths: (paths: string[], restore?: Record<string, SessionEdit>) => Promise<void>
  pickFiles: () => Promise<void>
  updateTrack: (id: string, patch: Partial<TrackItem>) => void
  updateTracksMeta: (ids: string[], metaPatch: Partial<TrackMetadata>) => void
  patchTracks: (ids: string[], patch: Partial<TrackItem>) => void
  deriveTracks: (patches: { id: string; meta: Partial<TrackMetadata> }[]) => void
  startOverTrack: (track: TrackItem) => void
  removeTrack: (id: string) => void
  removeTracks: (ids: string[]) => void
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
  onMetaReadFailed,
}: Params): TrackLibrary {
  const [tracks, setTracks] = useState<TrackItem[]>([])
  const tracksRef = useRef<TrackItem[]>([])
  tracksRef.current = tracks
  // Import progress, accumulated across overlapping drops via refs (the React state is just
  // the render mirror): each drop bumps the total, each finished read bumps done, and the
  // pair resets to null once everything in flight has landed — like the auto-match sweep.
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)
  // Tracks the watcher found in a loaded folder, parked until the user accepts the prompt.
  const [pendingNew, setPendingNew] = useState<PendingNew | null>(null)
  // Paths the user said no to: removed from the crate (row X or the multi-delete button) or
  // offered by the watcher and declined (✕, or the prompt timing out). Their files are still
  // on disk, so without this the watcher's next report — the safety poll fires every minute
  // whether or not anything changed — would flag each one as "new" again and again.
  const ignoredPaths = useRef(new Set<string>())
  const importDone = useRef(0)
  const importTotal = useRef(0)
  // Failed metadata reads in the in-flight batch, reported once when it settles so a
  // 300-file drop yields one "couldn't read N" notice rather than a toast per file.
  const importFailed = useRef(0)
  // removeTrack must keep a stable identity (memoized rows depend on it) while App's
  // registry-cleanup callback is recreated every render; the ref bridges the two.
  const onRemoveRef = useRef(onRemove)
  onRemoveRef.current = onRemove

  // Staged edits from the reopened session, waiting for their track's metadata read
  // to land so the restore can be overlaid on top of the fresh file read. Keyed by
  // source path and consumed (once) by loadTrackMeta.
  const restoredEdits = useRef(new Map<string, SessionEdit>())

  async function addPaths(paths: string[], restore?: Record<string, SessionEdit>): Promise<void> {
    // Read the live list, not the render snapshot: the native picker can sit open for
    // a long time, and a file that arrived through the OS meanwhile must still dedupe.
    const existing = new Set(tracksRef.current.map((t) => t.inputPath))
    const audio = paths.filter((p) => AUDIO_EXT.test(p))
    const fresh = audio.filter((p) => !existing.has(p))
    // Only genuinely new rows restore: a path already in the list is a live track
    // whose current state must not be clobbered by a stale saved edit.
    if (restore) {
      for (const path of fresh) {
        const edit = restore[path]
        if (edit) restoredEdits.current.set(path, edit)
      }
    }
    // Already-in-the-list audio files are skipped (re-dragging a folder is common);
    // report the count so App can surface it rather than the old silent no-op.
    const skipped = audio.length - fresh.length
    if (skipped > 0) onDuplicatesSkipped(skipped)
    if (fresh.length === 0) return
    // Show the rows the instant they're dropped, parsed from the file name, then fill in
    // tags, duration and cover as each file's read resolves. Reading metadata up front used
    // to block the whole drop behind the slowest file — on a cloud/network folder that's
    // seconds of an empty list that looks broken even though the import is running.
    const bases = fresh.map((path) => ({ ...newTrack(path), loadingMeta: true }))
    setTracks((prev) => [...prev, ...bases])
    // Every import route (drop, picker, Open With, watched folder) funnels through
    // here after dedup, so this is the one bump for the lifetime "loaded" tally.
    window.api.recordStat('imported', bases.length)
    setSelection((s) => (s.anchor ? s : { ids: [bases[0].id], anchor: bases[0].id }))
    importTotal.current += bases.length
    setImportProgress({ done: importDone.current, total: importTotal.current })
    void mapWithConcurrency(bases, READ_CONCURRENCY, async (base) => {
      const ok = await loadTrackMeta(base)
      if (!ok) importFailed.current += 1
      importDone.current += 1
      if (importDone.current >= importTotal.current) {
        importDone.current = 0
        importTotal.current = 0
        setImportProgress(null)
        if (importFailed.current > 0) {
          onMetaReadFailed(importFailed.current)
          importFailed.current = 0
        }
      } else {
        setImportProgress({ done: importDone.current, total: importTotal.current })
      }
    })
  }

  // The fields of a reopened session's staged edit that overlay the fresh file read.
  // The saved metadata wins over the file's own tags — it is the newer truth the user
  // had staged but not applied when the last session ended.
  function restoredPatch(saved: SessionEdit): Partial<TrackItem> {
    const patch: Partial<TrackItem> = {}
    if (saved.coverUrl || saved.coverRemoved) patch.coverUrl = saved.coverUrl
    if (saved.coverPath) patch.coverPath = saved.coverPath
    if (saved.coverRemoved) patch.coverRemoved = true
    if (saved.outputName) patch.outputName = saved.outputName
    if (saved.matched) patch.matched = true
    if (saved.autoMatched) patch.autoMatched = true
    if (saved.matchConfidence !== undefined) patch.matchConfidence = saved.matchConfidence
    return patch
  }

  async function loadTrackMeta(base: TrackItem): Promise<boolean> {
    const path = base.inputPath
    // Consumed exactly once: a later start-over on the same path must rebuild from
    // the file alone, not resurrect the restored edit.
    const saved = restoredEdits.current.get(path)
    restoredEdits.current.delete(path)
    try {
      const { tags, duration, cover } = await window.api.readMeta(path)
      const s = searchFromTags(parseFileName(path), tags)
      const readMeta: TrackMetadata = {
        ...base.meta,
        ...tags,
        title: s.title,
        artist: s.artist,
        albumArtist: tags.albumArtist || s.artist,
      }
      const patch: Partial<TrackItem> = {
        query: s.query,
        duration: duration ?? undefined,
        coverUrl: cover?.thumbUrl,
        embeddedCover: cover?.thumbUrl,
        embeddedCoverDims:
          cover && cover.width > 0 ? { w: cover.width, h: cover.height } : undefined,
        listLabel: s.title || base.fileName,
        loadingMeta: false,
      }
      if (saved) Object.assign(patch, restoredPatch(saved))
      // A restored edit replaces the read wholesale (it was itself built on a read of
      // this same file, plus everything the user staged since); the matched flag rides
      // in the patch so the auto-match sweep skips the row instead of overwriting it.
      const finalMeta = saved ? saved.meta : readMeta
      // The row is editable while the read runs, so merge instead of overwriting:
      // a field the user typed into meanwhile keeps the user's value, and the read
      // fills only what was left untouched.
      setTracks((prev) =>
        prev.map((t) =>
          t.id === base.id
            ? { ...t, ...patch, meta: mergeReadMeta(base.meta, t.meta, finalMeta) }
            : t,
        ),
      )
      onMetaLoaded({ ...base, ...patch, meta: finalMeta })
      return true
    } catch {
      // The row survives on its file-name parse, but flagged: without the mark, an
      // unreadable file is indistinguishable from a file that simply carries no tags.
      // A restored edit still applies — its metadata is better than the name parse,
      // and losing it to a transient read failure is exactly what the store prevents.
      const patch: Partial<TrackItem> = { loadingMeta: false, metaReadFailed: true }
      if (saved) Object.assign(patch, restoredPatch(saved))
      setTracks((prev) =>
        prev.map((t) =>
          t.id === base.id
            ? {
                ...t,
                ...patch,
                meta: saved ? mergeReadMeta(base.meta, t.meta, saved.meta) : t.meta,
              }
            : t,
        ),
      )
      return false
    }
  }

  // Right-click "Start over": rebuild the row from the file alone, exactly as if it had
  // just been dropped — re-parse the name, re-read tags/duration/cover, and drop every
  // edit, match and conversion state. The rebuilt track gets a fresh id so the editor
  // remounts and re-seeds its own state (the Discogs search box included) from the new
  // read; the selection swaps to the new id so the row stays open.
  function startOverTrack(track: TrackItem): void {
    const base = { ...newTrack(track.inputPath), loadingMeta: true }
    onForget(track.id)
    setTracks((prev) => prev.map((t) => (t.id === track.id ? base : t)))
    setSelection((s) => ({
      ids: s.ids.map((id) => (id === track.id ? base.id : id)),
      anchor: s.anchor === track.id ? base.id : s.anchor,
    }))
    void loadTrackMeta(base)
  }

  // Files opened from Finder ("Open With Surco"), dropped on the dock, or double-clicked
  // reach us through the OS, not the renderer: the main process buffers any handed over
  // before this window existed and pushes later ones live. Drain the buffer on mount and
  // subscribe for the rest, routing both through the same expand+add path as a drop. The
  // ref keeps the live handler pointed at the latest addPaths so its dedupe sees the
  // current crate rather than the empty one captured at mount.
  const addPathsRef = useRef(addPaths)
  addPathsRef.current = addPaths
  useEffect(() => {
    const open = async (paths: string[]): Promise<void> => {
      if (paths.length) addPathsRef.current(await window.api.expandPaths(paths))
    }
    window.api.takePendingFiles().then(open)
    return window.api.onOpenFiles(open)
  }, [])

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
      if (tracksRef.current.length === 0) {
        void window.api.unwatchFolders()
        return
      }
      // Outputs count as loaded too: converting into (or inside) the watched folder
      // must not offer Surco's own conversions back as "new tracks".
      const fresh = newTrackPaths(
        files,
        tracksRef.current.flatMap((t) => (t.outputPath ? [t.inputPath, t.outputPath] : [t.inputPath])),
      ).filter((p) => !ignoredPaths.current.has(p))
      setPendingNew((prev) => {
        if (fresh.length === 0) return prev?.root === root ? null : prev
        // Union with an outstanding prompt for the same folder so a second copy-in adds to
        // the count instead of replacing it; a different folder takes over the prompt.
        const merged =
          prev?.root === root ? Array.from(new Set([...prev.paths, ...fresh])) : fresh
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

  // The prompt dismisses itself after a while: it is an offer, not a question that blocks
  // anything. The timer restarts when the pending set changes (a second copy-in updates the
  // count) and is disarmed the moment the offer clears.
  useEffect(() => {
    if (!pendingNew) return
    const timer = setTimeout(dismissPending, NEW_TRACKS_PROMPT_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [pendingNew, dismissPending])

  async function pickFiles(): Promise<void> {
    // Expand the picker's result the same way a drop does: a folder picked on macOS walks
    // to its audio files, and ._ AppleDouble and hidden entries are filtered out either way.
    addPaths(await window.api.expandPaths(await window.api.pickFiles()))
  }

  const updateTrack = useCallback((id: string, patch: Partial<TrackItem>): void => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  // Writes a shared-field edit (or a dropped cover) onto every selected track at once —
  // the multi-select write path behind the editor's common-field form.
  const updateTracksMeta = useCallback((ids: string[], metaPatch: Partial<TrackMetadata>): void => {
    const targets = new Set(ids)
    setTracks((prev) =>
      prev.map((t) => (targets.has(t.id) ? { ...t, meta: { ...t.meta, ...metaPatch } } : t)),
    )
  }, [])

  const patchTracks = useCallback((ids: string[], patch: Partial<TrackItem>): void => {
    const targets = new Set(ids)
    setTracks((prev) => prev.map((t) => (targets.has(t.id) ? { ...t, ...patch } : t)))
  }, [])

  // Merges each track's own filename-derived tags into its metadata (one patch per id),
  // leaving fields the pattern didn't match untouched.
  const deriveTracks = useCallback(
    (patches: { id: string; meta: Partial<TrackMetadata> }[]): void => {
      const byId = new Map(patches.map((p) => [p.id, p.meta]))
      setTracks((prev) =>
        prev.map((t) => (byId.has(t.id) ? { ...t, meta: { ...t.meta, ...byId.get(t.id) } } : t)),
      )
    },
    [],
  )

  // Stable identity so the memoized TrackRow only re-renders the row that
  // changed. The functional update deselects iff the removed track was selected,
  // which is what the explicit selectedId check did before.
  const removeTrack = useCallback(
    (id: string): void => {
      const removed = tracksRef.current.find((t) => t.id === id)
      setTracks((prev) => prev.filter((t) => t.id !== id))
      setSelection((s) => deselect(s, id))
      if (removed) {
        ignoredPaths.current.add(removed.inputPath)
        onRemoveRef.current(removed)
      }
    },
    [setSelection],
  )

  // Drops a subset of rows from the list (the selection, or the filtered-visible set) —
  // the "empty" action when a format filter or selection is active, so the hidden
  // FLAC/WAV rows survive. Unlike clearTracks this keeps the folder watcher: tracks
  // remain, so a later added file should still show up.
  const removeTracks = useCallback(
    (ids: string[]): void => {
      const drop = new Set(ids)
      const removed = tracksRef.current.filter((t) => drop.has(t.id))
      setTracks((prev) => prev.filter((t) => !drop.has(t.id)))
      setSelection((s) => ({
        ids: s.ids.filter((id) => !drop.has(id)),
        anchor: s.anchor && drop.has(s.anchor) ? null : s.anchor,
      }))
      for (const track of removed) {
        ignoredPaths.current.add(track.inputPath)
        onRemoveRef.current(track)
      }
    },
    [setSelection],
  )

  function clearTracks(): void {
    const cleared = tracksRef.current
    setTracks([])
    setSelection({ ids: [], anchor: null })
    setPendingNew(null)
    ignoredPaths.current.clear()
    // Stop watching the emptied crate's folders; the next folder load rebuilds the watcher.
    void window.api.unwatchFolders()
    onClear(cleared)
  }

  return {
    tracks,
    pendingNew,
    loadPending,
    dismissPending,
    importProgress,
    setTracks,
    tracksRef,
    addPaths,
    pickFiles,
    updateTrack,
    updateTracksMeta,
    patchTracks,
    deriveTracks,
    startOverTrack,
    removeTrack,
    removeTracks,
    clearTracks,
  }
}
