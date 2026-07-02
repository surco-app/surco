import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { mediaUrl } from '../../../shared/media'
import type { TrackItem } from '../types'

interface Params {
  tracks: TrackItem[]
  // The anchor track: the follow-selection effect plays it while the player is open,
  // and the card falls back to it between opening and the first track loading.
  selected: TrackItem | null
  selectedId: string | null
}

// The selection has to rest this long before its playable is warmed, so arrowing
// through a crate doesn't fire a transcode per row it passes.
const PREWARM_SETTLE_MS = 400

export interface Player {
  // The shared <audio> element App renders; LivePlayer subscribes to it directly so
  // the playback clock never re-renders the app tree.
  audioRef: React.RefObject<HTMLAudioElement | null>
  playerVisible: boolean
  // The track whose card the player shows: the playing one, or the selection fallback.
  playerTrack: TrackItem | null
  togglePlay: () => void
  // Nudge the playhead by ±seconds (the ←/→ shortcuts, live while the player is open).
  seek: (delta: number) => void
  // The double-click-a-row gesture: plays that track (opening the player), or stops it
  // when it's already the one playing — a play/stop toggle on the row itself.
  toggleTrack: (track: TrackItem) => void
  closePlayer: () => void
}

// The floating player follows the selection: while it's open, picking another
// track plays it. Space toggles its visibility; the X (or Space again) closes.
export function usePlayer({ tracks, selected, selectedId }: Params): Player {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playerVisible, setPlayerVisible] = useState(false)
  // A synchronous mirror of playerVisible. The selection-follow effect reads it instead of
  // the state so a close that happens earlier in the same commit (Start over rebuilds the
  // playing track, firing the close effect, while the selection swaps to the new row in the
  // same render) is seen before React repaints — otherwise the follow effect re-arms
  // playback on the rebuilt row after its card has already closed.
  const playerVisibleRef = useRef(false)
  playerVisibleRef.current = playerVisible
  const [playingId, setPlayingId] = useState<string | null>(null)
  const playingIdRef = useRef<string | null>(null)
  playingIdRef.current = playingId

  // The path the element is currently streaming, so the rewrite watcher below can
  // tell a real file move from an ordinary re-render.
  const playingPathRef = useRef<string | null>(null)

  const startPlayback = useCallback((track: TrackItem): void => {
    const audio = audioRef.current
    if (!audio) return
    // The custom surco:// scheme streams the file from the main process, so the
    // <audio> element seeks through it without buffering the whole track in memory.
    audio.src = mediaUrl(track.inputPath)
    audio.currentTime = 0
    playingPathRef.current = track.inputPath
    setPlayingId(track.id)
    audio.play().catch(() => {})
  }, [])

  const closePlayer = useCallback((): void => {
    const audio = audioRef.current
    audio?.pause()
    audio?.removeAttribute('src')
    // Removing src alone doesn't release the media resource — the spec'd teardown
    // needs load(), or the closed track's stream stays attached until the next play.
    audio?.load()
    playerVisibleRef.current = false
    setPlayerVisible(false)
    setPlayingId(null)
  }, [])

  // Removing (or clearing) the track that is playing must stop the audio: the
  // file it streamed is gone from the list, so the player would otherwise keep
  // sounding it while the card shows a different, still-selected track.
  useEffect(() => {
    if (playingId && !tracks.some((t) => t.id === playingId)) closePlayer()
  }, [tracks, playingId, closePlayer])

  // An in-place export rewrites (and can rename) the playing track's file under the
  // stream; restart from the new path instead of holding a file that no longer exists.
  useEffect(() => {
    const playing = playingId ? tracks.find((t) => t.id === playingId) : undefined
    if (playing && playingPathRef.current && playing.inputPath !== playingPathRef.current) {
      startPlayback(playing)
    }
  }, [tracks, playingId, startPlayback])

  // Pressing play on an AIFF (Surco's default DJ format) stalls: Chromium can't
  // decode AIFF, so the surco:// handler transcodes the whole file to a temp WAV
  // before the first sound — paid in full in the gap after the click. Warming the
  // resolved playable for the rested selection runs (and caches) that transcode
  // ahead of time, overlapping it with the seconds the user spends reading the
  // track, so play then hits a cache and starts instantly. A 1-byte range request
  // drives the same main-process resolve without pulling the file across.
  useEffect(() => {
    const path = selected?.inputPath
    // Nothing to warm with no selection, and no point warming the track already
    // streaming under the element — its playable is resolved and cached.
    if (!path || selectedId === playingIdRef.current) return
    const controller = new AbortController()
    const id = setTimeout(() => {
      void fetch(mediaUrl(path), {
        headers: { Range: 'bytes=0-0' },
        signal: controller.signal,
      }).catch(() => {})
    }, PREWARM_SETTLE_MS)
    // A moved-on selection aborts the renderer's wait; the transcode it may have
    // already kicked off in main still finishes and caches, so the warm isn't wasted.
    return () => {
      clearTimeout(id)
      controller.abort()
    }
  }, [selectedId, selected?.inputPath])

  // Space toggles the player's visibility; the selection effect below starts
  // playback when it opens.
  function togglePlay(): void {
    if (playerVisible) closePlayer()
    else if (selected) setPlayerVisible(true)
  }

  // Nudge the playhead by delta seconds (the ←/→ shortcuts). Reads the live element so it
  // stays in step with the clock LivePlayer owns, and clamps to the file's bounds.
  const seek = useCallback((delta: number): void => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(audio.duration)) return
    audio.currentTime = Math.min(Math.max(audio.currentTime + delta, 0), audio.duration)
  }, [])

  // While the player is open, opening it or selecting another track plays that
  // track. Guarded against re-playing the one already loaded.
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedId is the trigger; `selected` is read fresh, and depending on it would re-fire every render.
  useEffect(() => {
    if (playerVisibleRef.current && selected && selected.id !== playingIdRef.current)
      startPlayback(selected)
  }, [selectedId, playerVisible, startPlayback])

  // Double-clicking a row toggles it: play the track (opening the player) unless it's
  // already the one playing, in which case stop. Keyed off the live playingId ref so the
  // callback stays stable and the memoized rows don't re-render on every play/stop.
  const toggleTrack = useCallback(
    (track: TrackItem): void => {
      if (playingIdRef.current === track.id) closePlayer()
      else {
        setPlayerVisible(true)
        startPlayback(track)
      }
    },
    [startPlayback, closePlayer],
  )

  // Falls back to the selection so the card still renders for the brief moment
  // between opening and the first track loading.
  const playerTrack = tracks.find((t) => t.id === playingId) ?? selected

  return { audioRef, playerVisible, playerTrack, togglePlay, seek, toggleTrack, closePlayer }
}
