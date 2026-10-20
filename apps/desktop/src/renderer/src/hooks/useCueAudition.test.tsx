// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCueAudition } from './useCueAudition'

const play = vi.fn<() => Promise<void>>()

const audios: FakeAudio[] = []
const frames: FrameRequestCallback[] = []

class FakeAudio {
  src: string
  onloadedmetadata: (() => void) | null = null
  onended: (() => void) | null = null
  currentTime = 0
  play = play
  pause = vi.fn<() => void>()
  load = vi.fn<() => void>()
  removeAttribute = vi.fn<(name: string) => void>()
  onerror: (() => void) | null = null
  constructor(src: string) {
    this.src = src
    audios.push(this)
  }
}

beforeEach(() => {
  play.mockReset().mockResolvedValue(undefined)

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
    expect(audios[0].pause).toHaveBeenCalled()
    expect(hook.result.current.playing).toBe(false)
    onPosition.mockClear()
    nextFrame()
    expect(onPosition).not.toHaveBeenCalled()
  })

  it('stops when the editor is no longer maximized', async () => {
    const { hook } = await started()
    hook.rerender({ path: '/m/g.wav', active: false })
    expect(audios[0].pause).toHaveBeenCalled()
    expect(hook.result.current.playing).toBe(false)
  })

  it('stops on another track', async () => {
    const { hook } = await started()
    hook.rerender({ path: '/m/other.wav', active: true })
    expect(audios[0].pause).toHaveBeenCalled()
  })

  it('stops when the section goes away', async () => {
    const { hook } = await started()
    hook.unmount()
    expect(audios[0].pause).toHaveBeenCalled()
  })

  it('releases the file of the element it stops so a conversion can replace it', async () => {
    const { hook } = await started()
    act(() => hook.result.current.stop())
    expect(audios[0].pause).toHaveBeenCalled()
    expect(audios[0].removeAttribute).toHaveBeenCalledWith('src')
    expect(audios[0].load).toHaveBeenCalled()
    expect(audios[0].onloadedmetadata).toBeNull()
    expect(audios[0].onended).toBeNull()
  })

  it('never sounds an element that was stopped before its metadata arrived', () => {
    const hook = renderHook(() => useCueAudition('/m/g.wav', true, vi.fn()))
    act(() => hook.result.current.toggle(64000))
    const old = audios[0]
    const late = old.onloadedmetadata
    act(() => hook.result.current.stop())
    late?.()
    expect(play).not.toHaveBeenCalled()
    expect(old.currentTime).toBe(0)
  })

  it('stays stopped when the browser refuses to play', async () => {
    play.mockRejectedValue(new Error('NotAllowed'))
    const { hook } = await started()
    expect(hook.result.current.playing).toBe(false)
  })

  it('ignores a late refusal from an element that was already replaced', async () => {
    let rejectOld: (e: Error) => void = () => {}
    play.mockReturnValueOnce(new Promise<void>((_, reject) => (rejectOld = reject)))
    const { hook } = await started()
    act(() => hook.result.current.stop())
    act(() => hook.result.current.toggle(1000))
    await act(async () => {
      audios[1].onloadedmetadata?.()
    })
    await act(async () => rejectOld(new Error('late')))
    expect(hook.result.current.playing).toBe(true)
    expect(audios[1].pause).not.toHaveBeenCalled()
  })

  it('stops when the element fails to load', async () => {
    const { hook } = await started()
    act(() => audios[0].onerror?.())
    expect(hook.result.current.playing).toBe(false)
  })

  it('honours a jump asked before the metadata arrived', () => {
    const hook = renderHook(() => useCueAudition('/m/g.wav', true, vi.fn()))
    act(() => hook.result.current.toggle(64000))
    act(() => hook.result.current.seek(96000))
    act(() => audios[0].onloadedmetadata?.())
    expect(audios[0].currentTime).toBe(96)
  })
})
