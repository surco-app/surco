import { describe, expect, it, vi } from 'vitest'
import { routeOpenedFile } from './openedFiles'

const deps = (over: Partial<Parameters<typeof routeOpenedFile>[1]> = {}) => ({
  window: () => null,
  ready: () => true,
  createWindow: vi.fn(),
  send: vi.fn(),
  pending: [] as string[],
  ...over,
})

describe('routeOpenedFile', () => {
  it('opens a window for a file opened from Finder while none is open', () => {
    const d = deps()
    routeOpenedFile('/m/a.wav', d)
    expect(d.pending).toEqual(['/m/a.wav'])
    expect(d.createWindow).toHaveBeenCalled()
  })

  it('only buffers before the app is ready, since the launch itself creates the window', () => {
    const d = deps({ ready: () => false })
    routeOpenedFile('/m/a.wav', d)
    expect(d.pending).toEqual(['/m/a.wav'])
    expect(d.createWindow).not.toHaveBeenCalled()
  })

  it('buffers for a window still loading, whose list drains the buffer once it mounts', () => {
    const d = deps({ window: () => ({ loading: true }) })
    routeOpenedFile('/m/a.wav', d)
    expect(d.pending).toEqual(['/m/a.wav'])
    expect(d.send).not.toHaveBeenCalled()
  })

  it('hands the file straight to a window that is up', () => {
    const d = deps({ window: () => ({ loading: false }) })
    routeOpenedFile('/m/a.wav', d)
    expect(d.send).toHaveBeenCalledWith(['/m/a.wav'])
    expect(d.pending).toEqual([])
  })
})
