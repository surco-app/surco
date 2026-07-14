import { useCallback, useEffect, useRef, useState } from 'react'
import { mediaUrl } from '../../../shared/media'

export type AbSide = 'original' | 'repaired'

// How far the silent leg may drift before it is snapped back. Small enough that a switch
// always lands on the same musical instant (a click is milliseconds wide, so a drifted
// A/B would compare two different moments and prove nothing); large enough that the
// correction is not re-seeking on every tick, which would stutter the audio it fixes.
const MAX_DRIFT_SEC = 0.02

interface Ab {
  side: AbSide
  playing: boolean
  at: number
  toggle: () => void
  play: () => void
  pause: () => void
  seek: (sec: number) => void
  ready: boolean
}

// The A/B: the original and the repaired render as two elements playing the SAME
// position at the same time, where the toggle only swaps which one is audible.
//
// Both stay running because that is the whole point of an A/B — stopping one and
// restarting the other drops a gap into the middle of the comparison, and the ear
// loses the reference across it. The repair's real failure (a softened snare attack,
// a dulled transient) is a subtle difference, and subtle differences only survive an
// instant switch. Muting is that switch: no seek, no buffer, no gap.
export function useDeclickAb(originalPath: string, repairedPath: string | null): Ab {
  const originalRef = useRef<HTMLAudioElement | null>(null)
  const repairedRef = useRef<HTMLAudioElement | null>(null)
  const frame = useRef<number | null>(null)
  const [side, setSide] = useState<AbSide>('repaired')
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!repairedPath) {
      setReady(false)
      return
    }
    const original = new Audio(mediaUrl(originalPath))
    const repaired = new Audio(mediaUrl(repairedPath))
    originalRef.current = original
    repairedRef.current = repaired
    // The pair starts on the repaired leg (what the user asked to hear); the other is
    // silent but running, so switching to it is instant.
    original.volume = 0
    repaired.volume = 1
    // The repaired element drives the clock: one source of truth, so the two can never
    // fight over the playhead.
    repaired.ontimeupdate = () => setAt(repaired.currentTime)
    // And the silent leg is pinned to the AUDIBLE one on every frame. Two elements buffer
    // and schedule independently, so play() on both does not start them together —
    // measured ~450 ms apart in the real app. Correcting only on timeupdate left ~44 ms
    // (it fires ~4×/s, so the gap reopens between ticks), and pinning to a fixed leg left
    // ~33 ms the moment the user switched sides, because the anchor was then the silent
    // one. A drifted A/B compares two different moments of the song while still *sounding*
    // like a comparison — the one failure this feature cannot afford, since the clicks it
    // exists to judge are milliseconds wide.
    const pin = (): void => {
      frame.current = requestAnimationFrame(pin)
      const heard = original.volume > 0 ? original : repaired
      const muted = heard === original ? repaired : original
      if (heard.paused) return
      if (Math.abs(muted.currentTime - heard.currentTime) > MAX_DRIFT_SEC)
        muted.currentTime = heard.currentTime
    }
    frame.current = requestAnimationFrame(pin)
    repaired.onended = () => {
      setPlaying(false)
      original.pause()
    }
    let loaded = 0
    const onLoad = (): void => {
      loaded++
      if (loaded === 2) setReady(true)
    }
    original.onloadedmetadata = onLoad
    repaired.onloadedmetadata = onLoad
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
      original.pause()
      repaired.pause()
      originalRef.current = null
      repairedRef.current = null
      setReady(false)
      setPlaying(false)
      setAt(0)
      setSide('repaired')
    }
  }, [originalPath, repairedPath])

  const toggle = useCallback(() => {
    setSide((s) => {
      const next: AbSide = s === 'repaired' ? 'original' : 'repaired'
      // Volume, not pause: the inaudible leg keeps rolling in lockstep so the switch
      // back is instant too.
      if (originalRef.current) originalRef.current.volume = next === 'original' ? 1 : 0
      if (repairedRef.current) repairedRef.current.volume = next === 'repaired' ? 1 : 0
      return next
    })
  }, [])

  const play = useCallback(() => {
    const original = originalRef.current
    const repaired = repairedRef.current
    if (!original || !repaired) return
    // Re-align before rolling: a paused pair can drift if one leg was still buffering
    // when the other stopped, and an A/B comparing two different instants is a lie.
    original.currentTime = repaired.currentTime
    void Promise.all([original.play(), repaired.play()])
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false))
  }, [])

  const pause = useCallback(() => {
    originalRef.current?.pause()
    repairedRef.current?.pause()
    setPlaying(false)
  }, [])

  // Both legs move together — this is what a click mark's "jump here" calls, and the
  // pair must land on the same instant or the comparison at that click is meaningless.
  const seek = useCallback((sec: number) => {
    const original = originalRef.current
    const repaired = repairedRef.current
    if (!original || !repaired) return
    original.currentTime = sec
    repaired.currentTime = sec
    setAt(sec)
  }, [])

  return { side, playing, at, toggle, play, pause, seek, ready }
}
