import { useCallback, useEffect, useRef, useState } from 'react'
import { mediaUrl } from '../../../shared/media'
import { holdForAudition } from '../lib/auditionHolds'

export interface CueAudition {
  playing: boolean
  toggle: (fromMs: number) => void
  seek: (ms: number) => void
  pause: () => void
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
  const ready = useRef(false)
  const wanted = useRef(false)
  const frame = useRef<number | null>(null)
  const soundingPath = useRef(path)
  const wantedMs = useRef(0)
  const latest = useRef(onPosition)
  latest.current = onPosition
  const lead = useRef(leadMs)
  lead.current = leadMs
  const unhold = useRef<(() => void) | null>(null)
  const [playing, setPlaying] = useState(false)

  const unfollow = useCallback((): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }, [])

  const stop = useCallback((): void => {
    unfollow()
    unhold.current?.()
    unhold.current = null
    wanted.current = false
    ready.current = false
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
  }, [unfollow])

  const pause = useCallback((): void => {
    unfollow()
    wanted.current = false
    audioRef.current?.pause()
    setPlaying(false)
  }, [unfollow])

  const follow = useCallback((audio: HTMLAudioElement): void => {
    const tick = () => {
      if (audioRef.current !== audio || !wanted.current) return
      latest.current(audio.currentTime * 1000 + lead.current)
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }, [])

  const sound = useCallback(
    (audio: HTMLAudioElement): void => {
      audio.currentTime = elementSec(wantedMs.current, lead.current)
      audio
        .play()
        .then(() => {
          if (audioRef.current === audio && wanted.current) follow(audio)
        })
        .catch(() => {
          if (audioRef.current === audio) stop()
        })
    },
    [follow, stop],
  )

  const load = useCallback((): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current
    const audio = new Audio(mediaUrl(path))
    audio.preload = 'auto'
    audioRef.current = audio
    ready.current = false
    unhold.current = holdForAudition(path, stop)
    soundingPath.current = path
    audio.onloadedmetadata = () => {
      if (audioRef.current !== audio) return
      ready.current = true
      if (wanted.current) sound(audio)
    }
    audio.onended = () => pause()
    audio.onerror = () => stop()
    return audio
  }, [path, stop, pause, sound])

  const start = useCallback(
    (fromMs: number): void => {
      for (const other of document.querySelectorAll('audio')) other.pause()
      const audio = load()
      wantedMs.current = fromMs
      wanted.current = true
      if (ready.current) sound(audio)
      setPlaying(true)
    },
    [load, sound],
  )

  const toggle = useCallback(
    (fromMs: number): void => (wanted.current ? pause() : start(fromMs)),
    [start, pause],
  )

  const seek = useCallback((ms: number): void => {
    wantedMs.current = ms
    if (audioRef.current) audioRef.current.currentTime = elementSec(ms, lead.current)
  }, [])

  useEffect(() => {
    if (!active) stop()
  }, [active, stop])

  useEffect(() => {
    if (soundingPath.current !== path) stop()
    if (active) load()
  }, [path, active, stop, load])

  useEffect(() => {
    if (!playing) return
    const onOther = (e: Event) => {
      if (e.target !== audioRef.current) pause()
    }
    document.addEventListener('play', onOther, true)
    return () => document.removeEventListener('play', onOther, true)
  }, [playing, pause])

  useEffect(() => stop, [stop])

  return { playing, toggle, seek, pause, stop }
}
