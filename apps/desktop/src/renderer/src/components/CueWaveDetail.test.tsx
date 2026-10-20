// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { MEMORY_CUE_COLOR } from '../../../shared/rekordboxCueColors'
import { HOT_MARK_PX, WAVE_MARK_LANE_PX } from '../lib/cueMarks'
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
    quantize: 'bar' as const,
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

  it('draws a visible line on every bar with a cap at each end, and no loose beats', () => {
    setup()
    const lines = screen.getAllByTestId('cue-detail-bar')
    expect(lines).toHaveLength(17)
    for (const line of lines) {
      expect(within(line).getAllByTestId('cue-detail-cap')).toHaveLength(2)
      expect(line.className).toContain('bg-[var(--color-fg-dim)]/35')
    }
    expect(screen.queryAllByTestId('cue-grid-cap')).toHaveLength(0)
  })

  it('draws a faint tick on every beat between the bar lines when quantizing to the beat, so a cue on a beat sits on the grid', () => {
    setup({ quantize: 'beat' })
    const ticks = screen.getAllByTestId('cue-detail-beat')
    expect(ticks).toHaveLength(48)
    const bars = new Set(screen.getAllByTestId('cue-detail-bar').map((b) => b.style.left))
    for (const tick of ticks) {
      expect(bars.has(tick.style.left)).toBe(false)
      expect(tick.className).toContain('bg-[var(--color-fg-dim)]/15')
      expect(within(tick).queryAllByTestId('cue-detail-cap')).toHaveLength(0)
    }
  })

  it('draws no beat ticks when quantizing to the bar, where every cue sits on a bar line', () => {
    setup()
    expect(screen.queryAllByTestId('cue-detail-beat')).toHaveLength(0)
  })

  it('paints the caps red on bars 1, 5, 9 and so on, counted from the grid and not from the window, and leaves the rest grey', () => {
    setup({ playheadMs: bar(33) })
    const lines = screen.getAllByTestId('cue-detail-bar')
    const phrases = lines.filter((l) => l.dataset.phrase === 'true')
    for (const line of lines) {
      expect(line.dataset.phrase === 'true').toBe((Number(line.dataset.bar) - 1) % 4 === 0)
    }
    expect(phrases.length).toBeGreaterThan(0)
    for (const line of lines) {
      const phrase = line.dataset.phrase === 'true'
      const [top, bottom] = within(line).getAllByTestId('cue-detail-cap')
      if (phrase) {
        expect(top.style.borderTopColor).not.toBe('')
        expect(bottom.style.borderBottomColor).not.toBe('')
      } else {
        expect(top.style.borderTopColor).toBe('')
        expect(bottom.style.borderBottomColor).toBe('')
      }
    }
    const [top, bottom] = within(phrases[0]).getAllByTestId('cue-detail-cap')
    const probe = document.createElement('i')
    probe.style.borderTopColor = MEMORY_CUE_COLOR
    expect(top.style.borderTopColor).toBe(probe.style.borderTopColor)
    expect(bottom.style.borderBottomColor).toBe(probe.style.borderTopColor)
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
    expect(screen.getByTestId('cue-detail-hot-B').style.left).toContain('75%')
    expect(screen.getByTestId('cue-detail-hot-B')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByTestId(`cue-detail-call-${bar(36)}`).style.left).toContain('75%')
    expect(screen.getByTestId(`cue-detail-call-${bar(40)}`).style.left).toContain('100%')
  })

  it('keeps the cue marks in a lane above the zoomed wave so they never sit on the bars', () => {
    setup({
      cues: [
        { key: 'b', ms: bar(36), kind: 2, color: 22, pending: false },
        { key: 'p', ms: bar(36), kind: 0, color: null, pending: false },
      ],
    })
    const lane = WAVE_MARK_LANE_PX
    expect(
      Number.parseFloat(screen.getByTestId('cue-detail-hot-B').style.top) + HOT_MARK_PX.wave,
    ).toBeLessThan(lane)
    expect(
      Number.parseFloat(screen.getByTestId(`cue-detail-call-${bar(36)}`).style.top) + 7,
    ).toBeLessThanOrEqual(lane)
    const canvas = screen.getByTestId('cue-detail').querySelector('canvas') as HTMLCanvasElement
    expect(canvas.style.top).toBe(`${lane}px`)
    expect(lane).toBe(HOT_MARK_PX.wave + 1)
    const call = screen.getByTestId(`cue-detail-call-${bar(36)}`)
    const hot = screen.getByTestId('cue-detail-hot-B')
    expect(call.style.top).toBe(hot.style.top)
    expect(call.compareDocumentPosition(hot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the playhead time left of the centre and the bars to the CALL right of it, in a row above the wave so nothing sits on it', () => {
    setup({ cues: [{ key: 'd', ms: bar(48), kind: 0, color: null, pending: false }] })
    expect(screen.getByTestId('cues-position')).toHaveTextContent('1:04.0')
    expect(screen.getByTestId('cue-detail-to-call')).toHaveTextContent('16 bars to the CALL')
    expect(screen.getByTestId('cue-detail')).not.toContainElement(
      screen.getByTestId('cues-position'),
    )
    expect(screen.getByTestId('cue-detail')).not.toContainElement(
      screen.getByTestId('cue-detail-to-call'),
    )
  })

  it('says one bar in the singular and keeps half a bar when the CALL sits off the bar', () => {
    const { rerender } = setup({
      cues: [{ key: 'd', ms: bar(33), kind: 0, color: null, pending: false }],
    })
    expect(screen.getByTestId('cue-detail-to-call')).toHaveTextContent('1 bar to the CALL')
    rerender({ cues: [{ key: 'd', ms: bar(40) + 1000, kind: 0, color: null, pending: false }] })
    expect(screen.getByTestId('cue-detail-to-call')).toHaveTextContent('8.5 bars to the CALL')
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

  it('hands the time under a click to onPick while the editor waits for a drop, instead of scrubbing', () => {
    const onPick = vi.fn<(ms: number) => void>()
    const { onScrub } = setup({ onPick })
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 300 })
    fireEvent.mouseMove(window, { clientX: 100 })
    expect(onPick).toHaveBeenCalledWith(bar(32) + 8000)
    expect(onScrub).not.toHaveBeenCalled()
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

  it('paints the wave in Surco accent like every other wave in the app, not in rekordbox colours', () => {
    const styles: string[] = []
    const fake = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      setTransform: vi.fn(),
      globalAlpha: 1,
      set fillStyle(v: string) {
        styles.push(v)
      },
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake as never)
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) => (name === '--color-accent' ? '#7aa2f7' : ''),
    } as never)
    const words = new Uint16Array(45000).fill((7 << 13) | (31 << 2))
    setup({ source: { words }, playheadMs: 150000 })
    expect(styles.length).toBeGreaterThan(0)
    expect(new Set(styles)).toEqual(new Set(['#7aa2f7']))
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

  it('puts no buttons over the wave, zoom lives on the keys and the trackpad', () => {
    setup()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('zooms with a pinch or ⌘ and the wheel, one step per swipe, and leaves a plain wheel alone', () => {
    const { onZoom } = setup()
    const stage = screen.getByTestId('cue-detail')
    expect(fireEvent.wheel(stage, { deltaY: -60, ctrlKey: true })).toBe(false)
    expect(onZoom.mock.calls).toEqual([['in']])
    fireEvent.wheel(stage, { deltaY: 25, metaKey: true })
    expect(onZoom).toHaveBeenCalledTimes(1)
    fireEvent.wheel(stage, { deltaY: 25, metaKey: true })
    expect(onZoom.mock.calls).toEqual([['in'], ['out']])
    expect(fireEvent.wheel(stage, { deltaY: -200 })).toBe(true)
    expect(onZoom).toHaveBeenCalledTimes(2)
  })

  it('keeps the zoomed wave a calm height however tall the window, so full screen adds room around it and not a giant wave', () => {
    setup()
    const stage = screen.getByTestId('cue-detail')
    const [, min, max] = stage.style.height.match(/^clamp\((\d+)px, .+, (\d+)px\)$/) ?? []
    expect(Number(min)).toBe(160)
    expect(Number(max)).toBeLessThanOrEqual(240)
    expect(stage.style.flexGrow).not.toBe('1')
  })

  it('leaves headroom above and below the loudest column, so a loud track never touches the edges', () => {
    const fillRect = vi.fn<(x: number, y: number, w: number, h: number) => void>()
    const fake = { clearRect: vi.fn(), fillRect, setTransform: vi.fn(), fillStyle: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake as never)
    const words = new Uint16Array(45000).fill((7 << 13) | (31 << 2))
    setup({ source: { words }, playheadMs: 150000 })
    expect(fillRect.mock.calls.length).toBeGreaterThan(0)
    for (const [, y, , h] of fillRect.mock.calls) {
      expect(y).toBeGreaterThanOrEqual(16)
      expect(y + h).toBeLessThanOrEqual(144)
    }
  })

  it('sizes the canvas to the stage it measures, so a resized stage never draws stretched', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 400,
      height: 300,
      right: 400,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const fake = { clearRect: vi.fn(), fillRect: vi.fn(), setTransform: vi.fn(), fillStyle: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake as never)
    setup()
    const canvas = screen.getByTestId('cue-detail').querySelector('canvas') as HTMLCanvasElement
    expect(canvas.height).toBe(300)
  })

  it('shows a crosshair over the wave while it waits for a drop, so the click reads as marking and not as grabbing', () => {
    const { rerender } = setup()
    expect(screen.getByTestId('cue-detail').style.cursor).toBe('grab')
    rerender({ onPick: vi.fn<(ms: number) => void>() })
    expect(screen.getByTestId('cue-detail').style.cursor).toBe('crosshair')
  })
  it('reports a right-click on a mark and does not scrub', () => {
    const onMarkMenu = vi.fn()
    const { onScrub } = setup({
      cues: [{ key: 'b', ms: bar(32), kind: 2, color: 22, pending: false }],
      onMarkMenu,
    })
    const mark = screen.getByTestId('cue-detail-hot-B')
    fireEvent.mouseDown(mark, { button: 2, clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 200 })
    fireEvent.contextMenu(mark, { clientX: 30, clientY: 4 })
    expect(onMarkMenu).toHaveBeenCalledWith({ key: 'b', clientX: 30, clientY: 4 })
    expect(onScrub).not.toHaveBeenCalled()
  })
  it('shows a ✕ on a hot cue while hovered, none on a locked loop, and the click neither scrubs nor bubbles', () => {
    const onDeleteMark = vi.fn()
    const { onScrub } = setup({
      cues: [
        { key: 'b', ms: bar(32), kind: 2, color: 22, pending: false },
        { key: 'l', ms: bar(34), kind: 3, color: 22, pending: false, locked: true },
      ],
      onDeleteMark,
    })
    fireEvent.mouseEnter(screen.getByTestId('cue-detail-hot-C'))
    expect(screen.queryByTestId('cue-detail-delete')).toBeNull()
    fireEvent.mouseEnter(screen.getByTestId('cue-detail-hot-B'))
    fireEvent.mouseDown(screen.getByTestId('cue-detail-delete'), { button: 0, clientX: 10 })
    fireEvent.click(screen.getByTestId('cue-detail-delete'))
    expect(onDeleteMark).toHaveBeenCalledWith('b')
    expect(onScrub).not.toHaveBeenCalled()
  })
})
