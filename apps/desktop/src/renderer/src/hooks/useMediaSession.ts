import type React from 'react'
import { useEffect } from 'react'
import type { TrackItem } from '../types'
import { useLatest } from './useLatest'

interface Params {
  audioRef: React.RefObject<HTMLAudioElement | null>
  track: TrackItem | null
  moveSelection: (delta: number) => void
}

// Reports the playing track to the system media session, which macOS shows in Now Playing
// and the media keys, AirPods and Watch control. Play and pause need no handler: Chromium
// drives the <audio> element itself.
export function useMediaSession({ audioRef, track, moveSelection }: Params): void {
  const move = useLatest(moveSelection)
  const playing = track !== null

  useEffect(() => {
    if (!track) {
      navigator.mediaSession.metadata = null
      return
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.meta.title || track.fileName,
      artist: track.meta.artist,
      album: track.meta.album,
      artwork: track.embeddedCover ? [{ src: track.embeddedCover }] : [],
    })
  }, [track])

  useEffect(() => {
    if (!playing) return
    const session = navigator.mediaSession
    session.setActionHandler('nexttrack', () => move.current(1))
    session.setActionHandler('previoustrack', () => move.current(-1))
    session.setActionHandler('seekto', (details) => {
      const audio = audioRef.current
      if (audio && details.seekTime !== undefined) audio.currentTime = details.seekTime
    })
    return () => {
      session.setActionHandler('nexttrack', null)
      session.setActionHandler('previoustrack', null)
      session.setActionHandler('seekto', null)
    }
  }, [playing, audioRef, move])
}
