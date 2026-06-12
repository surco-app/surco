import type React from 'react'
import { useEffect } from 'react'
import { generateDockIconFrames } from '../lib/dockIcon'

// Animates the Dock icon's engraved wave while the shared <audio> element plays.
// Listening on the element (not the player state) catches every way playback
// starts or stops: Space, follow-selection, track end, file removal.
export function useDockPlayingIndicator(audioRef: React.RefObject<HTMLAudioElement | null>): void {
  useEffect(() => {
    if (window.api.platform !== 'darwin') return
    const audio = audioRef.current
    if (!audio) return
    let cancelled = false
    // A failed rasterization just leaves the static icon; nothing to surface.
    generateDockIconFrames().then(
      (frames) => {
        if (!cancelled) window.api.setDockFrames(frames)
      },
      () => {},
    )
    const onPlay = (): void => window.api.setDockPlaying(true)
    const onPause = (): void => window.api.setDockPlaying(false)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    // Closing the player tears the element down with pause() + load(), and the
    // media load algorithm discards the queued pause event; 'emptied' is what
    // actually fires when the element resets.
    audio.addEventListener('emptied', onPause)
    return () => {
      cancelled = true
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('emptied', onPause)
    }
  }, [audioRef])
}
