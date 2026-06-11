import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrackMetadata } from '../../../shared/types'
import { mapWithConcurrency } from '../lib/concurrency'
import { parseFileName } from '../lib/filename'
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
}

export interface TrackLibrary {
  tracks: TrackItem[]
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
}: Params): TrackLibrary {
  const [tracks, setTracks] = useState<TrackItem[]>([])
  const tracksRef = useRef<TrackItem[]>([])
  tracksRef.current = tracks
  // removeTrack must keep a stable identity (memoized rows depend on it) while App's
  // registry-cleanup callback is recreated every render; the ref bridges the two.
  const onRemoveRef = useRef(onRemove)
  onRemoveRef.current = onRemove

  async function addPaths(paths: string[]): Promise<void> {
    // Read the live list, not the render snapshot: the native picker can sit open for
    // a long time, and a file that arrived through the OS meanwhile must still dedupe.
    const existing = new Set(tracksRef.current.map((t) => t.inputPath))
    const fresh = paths.filter((p) => AUDIO_EXT.test(p) && !existing.has(p))
    if (fresh.length === 0) return
    // Show the rows the instant they're dropped, parsed from the file name, then fill in
    // tags, duration and cover as each file's read resolves. Reading metadata up front used
    // to block the whole drop behind the slowest file — on a cloud/network folder that's
    // seconds of an empty list that looks broken even though the import is running.
    const bases = fresh.map((path) => ({ ...newTrack(path), loadingMeta: true }))
    setTracks((prev) => [...prev, ...bases])
    setSelection((s) => (s.anchor ? s : { ids: [bases[0].id], anchor: bases[0].id }))
    void mapWithConcurrency(bases, READ_CONCURRENCY, loadTrackMeta)
  }

  async function loadTrackMeta(base: TrackItem): Promise<void> {
    const path = base.inputPath
    try {
      const [tags, duration, cover] = await Promise.all([
        window.api.readTags(path),
        window.api.readDuration(path),
        window.api.readCover(path),
      ])
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
        coverUrl: cover ?? undefined,
        embeddedCover: cover ?? undefined,
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

  async function pickFiles(): Promise<void> {
    addPaths(await window.api.pickFiles())
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

  function clearTracks(): void {
    const cleared = tracksRef.current
    setTracks([])
    setSelection({ ids: [], anchor: null })
    onClear(cleared)
  }

  return {
    tracks,
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
    clearTracks,
  }
}
