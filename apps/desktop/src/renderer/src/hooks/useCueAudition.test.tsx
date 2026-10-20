// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCueAudition } from './useCueAudition'

const play = vi.fn<() => Promise<void>>()
const pause = vi.fn<() => void>()
const audios: FakeAudio[] = []
const frames: FrameRequestCallback[] = []

class FakeAudio {
  src: string
  onloadedmetadata: (() => void) | null = null
  onended: (() => void) | null = null
  currentTime = 0
  play = play
  pause = pause
  constructor(src: string) {
    this.src = src
    audios.push(this)
  }
}

beforeEach(() => {
  play.mockReset().mockResolvedValue(undefined)
  pause.mockReset()
  audios.length = 0
  frames.length = 0
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const nextFrame = () =>
  act(() => {
    for (const frame of frames.splice(0)) frame(0)
  })

async function started(onPosition = vi.fn<(ms: number) => void>()) {
  const hook = renderHook(
    (props: { path: string; active: boolean }) =>
      useCueAudition(props.path, props.active, onPosition),
    { initialProps: { path: '/m/g.wav', active: true } },
  )
  act(() => hook.result.current.toggle(64000))
  await act(async () => {
    audios[0].onloadedmetadata?.()
  })
  return { hook, onPosition }
}

describe('useCueAudition', () => {
  it('plays the track from the playhead and pauses the floating player so two never sound', async () => {
    const shared = document.body.appendChild(document.createElement('audio'))
    const pauseShared = vi.fn()
    shared.pause = pauseShared
    const { hook } = await started()
    expect(audios[0].src).toContain('g.wav')
    expect(audios[0].currentTime).toBe(64)
    expect(play).toHaveBeenCalled()
    expect(pauseShared).toHaveBeenCalled()
    expect(hook.result.current.playing).toBe(true)
  })

  it('moves the playhead with the sound on every frame so the wave follows without jumps', async () => {
    const { onPosition } = await started()
    audios[0].currentTime = 64.5
    nextFrame()
    expect(onPosition).toHaveBeenLastCalledWith(64500)
    audios[0].currentTime = 64.75
    nextFrame()
    expect(onPosition).toHaveBeenLastCalledWith(64750)
  })

  it('keeps sounding from the new point when the playhead jumps while it plays', async () => {
    const { hook } = await started()
    act(() => hook.result.current.seek(96000))
    expect(audios[0].currentTime).toBe(96)
    expect(audios).toHaveLength(1)
  })

  it('stops on a second toggle and stops following', async () => {
    const { hook, onPosition } = await started()
    act(() => hook.result.current.toggle(0))
    expect(pause).toHaveBeenCalled()
    expect(hook.result.current.playing).toBe(false)
    onPosition.mockClear()
    nextFrame()
    expect(onPosition).not.toHaveBeenCalled()
  })

  it('stops when the editor is no longer maximized', async () => {
    const { hook } = await started()
    hook.rerender({ path: '/m/g.wav', active: false })
    expect(pause).toHaveBeenCalled()
    expect(hook.result.current.playing).toBe(false)
  })

  it('stops on another track', async () => {
    const { hook } = await started()
    hook.rerender({ path: '/m/other.wav', active: true })
    expect(pause).toHaveBeenCalled()
  })

  it('stops when the section goes away', async () => {
    const { hook } = await started()
    hook.unmount()
    expect(pause).toHaveBeenCalled()
  })
})
