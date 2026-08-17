// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeclickAb } from './useDeclickAb'

// jsdom's HTMLMediaElement has no playback: play() rejects, currentTime never advances,
// paused never flips. Stubbed to the parts the hook actually drives, so the frame loop
// can be observed doing (or not doing) its work.
class FakeAudio {
  paused = true
  volume = 1
  currentTime = 0
  duration = 100
  ontimeupdate: (() => void) | null = null
  onended: (() => void) | null = null
  onloadedmetadata: (() => void) | null = null
  play = vi.fn(async () => {
    this.paused = false
  })
  pause = vi.fn(() => {
    this.paused = true
  })
  constructor() {
    created.push(this)
  }
}

let created: FakeAudio[] = []
let rafCalls = 0
let rafQueue: FrameRequestCallback[] = []

beforeEach(() => {
  created = []
  rafCalls = 0
  rafQueue = []
  vi.stubGlobal('Audio', FakeAudio)
  // Frames are pumped by hand: the loop re-arms itself, so running the queue once per
  // pump is what keeps a runaway loop from hanging the test.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCalls++
    rafQueue.push(cb)
    return rafCalls
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function pumpFrames(n: number): void {
  for (let i = 0; i < n; i++) {
    const queued = rafQueue
    rafQueue = []
    for (const cb of queued) cb(0)
  }
}

describe('useDeclickAb', () => {
  // The pair's silent leg is re-pinned to the audible one every frame, which is right
  // while the comparison is rolling and pure waste while it is not. The loop used to
  // re-arm itself before the paused check, so it ran at 60fps for as long as the
  // section stayed open — keeping the compositor awake and the renderer off idle for a
  // preview nobody is listening to.
  it('runs no frame loop while the pair is paused', () => {
    renderHook(() => useDeclickAb('/music/a.wav', '/tmp/repaired.wav'))
    act(() => {
      for (const a of created) a.onloadedmetadata?.()
    })
    const afterMount = rafCalls

    pumpFrames(5)

    expect(rafCalls).toBe(afterMount)
  })

  // And the pinning still has to happen while it is: a silent leg that drifts turns the
  // A/B into a comparison of two different instants, which is the one thing this
  // feature cannot get wrong.
  it('pins the silent leg to the audible one while playing', async () => {
    const { result } = renderHook(() => useDeclickAb('/music/a.wav', '/tmp/repaired.wav'))
    act(() => {
      for (const a of created) a.onloadedmetadata?.()
    })
    await act(async () => {
      result.current.play()
    })
    const [original, repaired] = created
    // The audible leg (repaired, by default) moves; the silent one lags well past the
    // drift tolerance.
    repaired.currentTime = 10
    original.currentTime = 9

    pumpFrames(1)

    expect(original.currentTime).toBe(10)
  })

  it('stops the frame loop again once the pair is paused', async () => {
    const { result } = renderHook(() => useDeclickAb('/music/a.wav', '/tmp/repaired.wav'))
    act(() => {
      for (const a of created) a.onloadedmetadata?.()
    })
    await act(async () => {
      result.current.play()
    })
    pumpFrames(2)
    act(() => {
      result.current.pause()
    })
    const afterPause = rafCalls

    pumpFrames(5)

    expect(rafCalls).toBe(afterPause)
  })
})
