import { useCallback, useEffect, useRef, useState } from 'react'
import { mediaUrl } from '../../../shared/media'
import { holdForAudition } from '../lib/auditionHolds'

export interface CueAudition {
  playing: boolean
  toggle: (fromMs: number) => void
  seek: (ms: number) => void
  stop: () => void
}

const elementSec = (ms: number, leadMs: number): number => Math.max(0, ms - leadMs) / 1000

export function useCueAudition(
  path: string,
  active: boolean,
  onPosition: (ms: number) => void,
  leadMs = 0,
): CueAudition {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const frame = useRef<number | null>(null)
  const soundingPath = useRef(path)
  const wantedMs = useRef(0)
  const latest = useRef(onPosition)
  latest.current = onPosition
  const lead = useRef(leadMs)
  lead.current = leadMs
  const unhold = useRef<(() => void) | null>(null)
  const [playing, setPlaying] = useState(false)

  const stop = useCallback((): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    unhold.current?.()
    unhold.current = null
    const audio = audioRef.current
    audioRef.current = null
    if (audio) {
      audio.onloadedmetadata = null
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    setPlaying(false)
  }, [])

  const follow = useCallback((audio: HTMLAudioElement): void => {
    const tick = () => {
      if (audioRef.current !== audio) return
      latest.current(audio.currentTime * 1000 + lead.current)
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
      unhold.current = holdForAudition(path, stop)
      soundingPath.current = path
      wantedMs.current = fromMs
      audio.onloadedmetadata = () => {
        if (audioRef.current !== audio) return
        audio.currentTime = elementSec(wantedMs.current, lead.current)
        audio
          .play()
          .then(() => {
            if (audioRef.current === audio) follow(audio)
          })
          .catch(() => {
            if (audioRef.current === audio) stop()
          })
      }
      audio.onended = () => stop()
      audio.onerror = () => stop()
      setPlaying(true)
    },
    [path, stop, follow],
  )

  const toggle = useCallback(
    (fromMs: number): void => (audioRef.current ? stop() : start(fromMs)),
    [start, stop],
  )

  const seek = useCallback((ms: number): void => {
    wantedMs.current = ms
    if (audioRef.current) audioRef.current.currentTime = elementSec(ms, lead.current)
  }, [])

  useEffect(() => {
    if (!active) stop()
  }, [active, stop])

  useEffect(() => {
    if (!playing) return
    const onOther = (e: Event) => {
      if (e.target !== audioRef.current) stop()
    }
    document.addEventListener('play', onOther, true)
    return () => document.removeEventListener('play', onOther, true)
  }, [playing, stop])

  useEffect(() => {
    if (soundingPath.current !== path) stop()
  }, [path, stop])

  useEffect(() => stop, [stop])

  return { playing, toggle, seek, stop }
}
