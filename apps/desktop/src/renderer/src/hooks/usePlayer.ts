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

export interface Player {
  // The shared <audio> element App renders; LivePlayer subscribes to it directly so
  // the playback clock never re-renders the app tree.
  audioRef: React.RefObject<HTMLAudioElement | null>
  playerVisible: boolean
  // The track whose card the player shows: the playing one, or the selection fallback.
  playerTrack: TrackItem | null
  togglePlay: () => void
  closePlayer: () => void
}

// The floating player follows the selection: while it's open, picking another
// track plays it. Space toggles its visibility; the X (or Space again) closes.
export function usePlayer({ tracks, selected, selectedId }: Params): Player {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playerVisible, setPlayerVisible] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const playingIdRef = useRef<string | null>(null)
  playingIdRef.current = playingId

  const startPlayback = useCallback((track: TrackItem): void => {
    const audio = audioRef.current
    if (!audio) return
    // The custom surco:// scheme streams the file from the main process, so the
    // <audio> element seeks through it without buffering the whole track in memory.
    audio.src = mediaUrl(track.inputPath)
    audio.currentTime = 0
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
    setPlayerVisible(false)
    setPlayingId(null)
  }, [])

  // Removing (or clearing) the track that is playing must stop the audio: the
  // file it streamed is gone from the list, so the player would otherwise keep
  // sounding it while the card shows a different, still-selected track.
  useEffect(() => {
    if (playingId && !tracks.some((t) => t.id === playingId)) closePlayer()
  }, [tracks, playingId, closePlayer])

  // Space toggles the player's visibility; the selection effect below starts
  // playback when it opens.
  function togglePlay(): void {
    if (playerVisible) closePlayer()
    else if (selected) setPlayerVisible(true)
  }

  // While the player is open, opening it or selecting another track plays that
  // track. Guarded against re-playing the one already loaded.
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedId is the trigger; `selected` is read fresh, and depending on it would re-fire every render.
  useEffect(() => {
    if (playerVisible && selected && selected.id !== playingIdRef.current) startPlayback(selected)
  }, [selectedId, playerVisible, startPlayback])

  // Falls back to the selection so the card still renders for the brief moment
  // between opening and the first track loading.
  const playerTrack = tracks.find((t) => t.id === playingId) ?? selected

  return { audioRef, playerVisible, playerTrack, togglePlay, closePlayer }
}
