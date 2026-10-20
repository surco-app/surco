import { useCallback, useEffect, useRef, useState } from 'react'
import { mediaUrl } from '../../../shared/media'

export interface CueAudition {
  playing: boolean
  toggle: (fromMs: number) => void
  seek: (ms: number) => void
  stop: () => void
}

export function useCueAudition(
  path: string,
  active: boolean,
  onPosition: (ms: number) => void,
): CueAudition {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const frame = useRef<number | null>(null)
  const soundingPath = useRef(path)
  const latest = useRef(onPosition)
  latest.current = onPosition
  const [playing, setPlaying] = useState(false)

  const stop = useCallback((): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    audioRef.current?.pause()
    audioRef.current = null
    setPlaying(false)
  }, [])

  const follow = useCallback((audio: HTMLAudioElement): void => {
    const tick = () => {
      if (audioRef.current !== audio) return
      latest.current(audio.currentTime * 1000)
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }, [])

  const start = useCallback(
    (fromMs: number): void => {
      stop()
      for (const other of document.querySelectorAll('audio')) other.pause()
      const audio = new Audio(mediaUrl(path))
      audioRef.current = audio
      soundingPath.current = path
      audio.onloadedmetadata = () => {
        audio.currentTime = fromMs / 1000
        audio
          .play()
          .then(() => {
            if (audioRef.current === audio) follow(audio)
          })
          .catch(() => stop())
      }
      audio.onended = () => stop()
      setPlaying(true)
    },
    [path, stop, follow],
  )

  const toggle = useCallback(
    (fromMs: number): void => (audioRef.current ? stop() : start(fromMs)),
    [start, stop],
  )

  const seek = useCallback((ms: number): void => {
    if (audioRef.current) audioRef.current.currentTime = ms / 1000
  }, [])

  useEffect(() => {
    if (!active) stop()
  }, [active, stop])

  useEffect(() => {
    if (soundingPath.current !== path) stop()
  }, [path, stop])

  useEffect(() => stop, [stop])

  return { playing, toggle, seek, stop }
}
