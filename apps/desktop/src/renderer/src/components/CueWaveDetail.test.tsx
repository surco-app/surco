// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { CueWaveDetail } from './CueWaveDetail'

const GRID = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
const bar = (n: number) => n * 2000

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 400,
    height: 160,
    right: 400,
    bottom: 160,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

function setup(over: Partial<React.ComponentProps<typeof CueWaveDetail>> = {}) {
  const onScrub = vi.fn<(ms: number) => void>()
  const onZoom = vi.fn<(dir: 'in' | 'out') => void>()
  const props = {
    source: null,
    grid: GRID,
    cues: [],
    selected: null,
    playheadMs: bar(32),
    bars: 16,
    onScrub,
    onZoom,
    ...over,
  }
  const view = render(<CueWaveDetail {...props} />)
  const rerender = (next: Partial<React.ComponentProps<typeof CueWaveDetail>>) =>
    view.rerender(<CueWaveDetail {...props} {...next} />)
  return { onScrub, onZoom, rerender }
}

describe('CueWaveDetail', () => {
  it('shows the bars around the playhead, which stays fixed in the centre', () => {
    const { rerender } = setup()
    expect(screen.getAllByTestId('cue-detail-bar')).toHaveLength(17)
    const lefts = () => screen.getAllByTestId('cue-detail-bar').map((b) => b.style.left)
    const before = lefts()
    expect(screen.getByTestId('cue-detail-playhead').style.left).toBe('')
    rerender({ playheadMs: bar(32) + 1000 })
    expect(lefts()).not.toEqual(before)
    expect(screen.getByTestId('cue-detail-playhead').style.left).toBe('')
  })

  it('shows fewer bars once zoomed in', () => {
    setup({ bars: 8 })
    expect(screen.getAllByTestId('cue-detail-bar')).toHaveLength(9)
  })

  it('draws the cues inside the window by the shared rule and leaves out the rest', () => {
    setup({
      cues: [
        { key: 'a', ms: bar(16), kind: 1, color: 42, pending: false },
        { key: 'b', ms: bar(36), kind: 2, color: 22, pending: false },
        { key: 'p', ms: bar(36), kind: 0, color: null, pending: false },
        { key: 'd', ms: bar(40), kind: 0, color: null, pending: true },
      ],
      selected: 'b',
    })
    expect(screen.queryByTestId('cue-detail-hot-A')).toBeNull()
    expect(screen.getByTestId('cue-detail-hot-B').style.left).toBe('75%')
    expect(screen.getByTestId('cue-detail-hot-B')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByTestId(`cue-detail-call-${bar(36)}`).style.left).toBe('75%')
    expect(screen.getByTestId(`cue-detail-call-${bar(40)}`).style.left).toBe('100%')
  })

  it('says how many bars are left to the next CALL, as rekordbox does above the playhead', () => {
    setup({ cues: [{ key: 'd', ms: bar(48), kind: 0, color: null, pending: false }] })
    expect(screen.getByTestId('cue-detail-to-call')).toHaveTextContent('-16.0 bars to the CALL')
  })

  it('says nothing about a CALL when none lies ahead', () => {
    setup({ cues: [{ key: 'd', ms: bar(8), kind: 0, color: null, pending: false }] })
    expect(screen.queryByTestId('cue-detail-to-call')).toBeNull()
  })

  it('moves the playhead forward when the wave is dragged left, as the wave runs under it', () => {
    const { onScrub } = setup()
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 400 })
    fireEvent.mouseMove(window, { clientX: 300 })
    expect(onScrub).toHaveBeenLastCalledWith(bar(32) + 8000)
    fireEvent.mouseUp(window, { clientX: 300 })
    fireEvent.mouseMove(window, { clientX: 100 })
    expect(onScrub).toHaveBeenCalledTimes(1)
  })

  it('paints at most one column per pixel however long the track, so a 5 minute wave stays smooth', () => {
    const fillRect = vi.fn()
    const fake = { clearRect: vi.fn(), fillRect, setTransform: vi.fn(), fillStyle: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake as never)
    const words = new Uint16Array(45000).fill((7 << 13) | (31 << 2))
    setup({ source: { words }, playheadMs: 150000 })
    expect(fillRect.mock.calls.length).toBeGreaterThan(0)
    expect(fillRect.mock.calls.length).toBeLessThanOrEqual(400)
  })

  it('scales the canvas by the device pixel ratio but still paints one column per CSS pixel', () => {
    vi.stubGlobal('devicePixelRatio', 2)
    const fillRect = vi.fn()
    const setTransform = vi.fn()
    const fake = { clearRect: vi.fn(), fillRect, setTransform, fillStyle: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake as never)
    const words = new Uint16Array(45000).fill((7 << 13) | (31 << 2))
    setup({ source: { words }, playheadMs: 150000 })
    const canvas = screen.getByTestId('cue-detail').querySelector('canvas') as HTMLCanvasElement
    expect(canvas.width).toBe(800)
    expect(canvas.height).toBe(320)
    expect(setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0)
    expect(fillRect.mock.calls.length).toBeLessThanOrEqual(400)
    vi.unstubAllGlobals()
  })

  it('redraws when the wave is resized', () => {
    let notify: () => void = () => {}
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          notify = cb
        }
        observe() {}
        disconnect() {}
      },
    )
    const clearRect = vi.fn()
    const fake = { clearRect, fillRect: vi.fn(), setTransform: vi.fn(), fillStyle: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake as never)
    setup()
    const drawn = clearRect.mock.calls.length
    act(() => notify())
    expect(clearRect.mock.calls.length).toBeGreaterThan(drawn)
    vi.unstubAllGlobals()
  })

  it('draws a pending hot cue outlined and a pending CALL marked, as the section does', () => {
    setup({
      cues: [
        { key: 'b', ms: bar(36), kind: 2, color: 22, pending: true },
        { key: 'd', ms: bar(40), kind: 0, color: null, pending: true },
        { key: 'e', ms: bar(34), kind: 0, color: null, pending: false },
      ],
    })
    const hot = screen.getByTestId('cue-detail-hot-B')
    expect(hot).toHaveAttribute('data-pending', 'true')
    expect(hot.style.backgroundColor).toBe('')
    expect(hot.style.borderColor).not.toBe('')
    expect(screen.getByTestId(`cue-detail-call-${bar(40)}`)).toHaveAttribute('data-pending', 'true')
    expect(screen.getByTestId(`cue-detail-call-${bar(34)}`)).toHaveAttribute(
      'data-pending',
      'false',
    )
  })

  it('zooms with its buttons and stops at 4 and 64 bars', () => {
    const { onZoom } = setup({ bars: 4 })
    expect(screen.getByTestId('cue-detail-zoom-in')).toBeDisabled()
    fireEvent.click(screen.getByTestId('cue-detail-zoom-out'))
    expect(onZoom).toHaveBeenCalledWith('out')
  })

  it('stops zooming out at 64 bars', () => {
    setup({ bars: 64 })
    expect(screen.getByTestId('cue-detail-zoom-out')).toBeDisabled()
  })
})
