import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrackMetadata } from '../../../shared/types'
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
  addPaths: (paths: string[]) => Promise<void>
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
  const importDone = useRef(0)
  const importTotal = useRef(0)
  // removeTrack must keep a stable identity (memoized rows depend on it) while App's
  // registry-cleanup callback is recreated every render; the ref bridges the two.
  const onRemoveRef = useRef(onRemove)
  onRemoveRef.current = onRemove

  async function addPaths(paths: string[]): Promise<void> {
    // Read the live list, not the render snapshot: the native picker can sit open for
    // a long time, and a file that arrived through the OS meanwhile must still dedupe.
    const existing = new Set(tracksRef.current.map((t) => t.inputPath))
    const audio = paths.filter((p) => AUDIO_EXT.test(p))
    const fresh = audio.filter((p) => !existing.has(p))
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
    setSelection((s) => (s.anchor ? s : { ids: [bases[0].id], anchor: bases[0].id }))
    importTotal.current += bases.length
    setImportProgress({ done: importDone.current, total: importTotal.current })
    void mapWithConcurrency(bases, READ_CONCURRENCY, async (base) => {
      await loadTrackMeta(base)
      importDone.current += 1
      if (importDone.current >= importTotal.current) {
        importDone.current = 0
        importTotal.current = 0
        setImportProgress(null)
      } else {
        setImportProgress({ done: importDone.current, total: importTotal.current })
      }
    })
  }

  async function loadTrackMeta(base: TrackItem): Promise<void> {
    const path = base.inputPath
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
      // The row is editable while the read runs, so merge instead of overwriting:
      // a field the user typed into meanwhile keeps the user's value, and the read
      // fills only what was left untouched.
      setTracks((prev) =>
        prev.map((t) =>
          t.id === base.id
            ? { ...t, ...patch, meta: mergeReadMeta(base.meta, t.meta, readMeta) }
            : t,
        ),
      )
      onMetaLoaded({ ...base, ...patch, meta: readMeta })
    } catch {
      updateTrack(base.id, { loadingMeta: false })
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
      const fresh = newTrackPaths(
        files,
        tracksRef.current.map((t) => t.inputPath),
      )
      setPendingNew((prev) => {
        if (fresh.length === 0) return prev?.root === root ? null : prev
        // Union with an outstanding prompt for the same folder so a second copy-in adds to
        // the count instead of replacing it; a different folder takes over the prompt.
        const merged =
          prev?.root === root ? Array.from(new Set([...prev.paths, ...fresh])) : fresh
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

  const dismissPending = useCallback((): void => setPendingNew(null), [])

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
      if (removed) onRemoveRef.current(removed)
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
      for (const track of removed) onRemoveRef.current(track)
    },
    [setSelection],
  )

  function clearTracks(): void {
    const cleared = tracksRef.current
    setTracks([])
    setSelection({ ids: [], anchor: null })
    setPendingNew(null)
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
