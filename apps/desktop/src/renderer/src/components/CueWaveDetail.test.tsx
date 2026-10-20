// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { hotCueColor, MEMORY_CUE_COLOR } from '../../../shared/rekordboxCueColors'
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
    points: [],
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
    setup({ points: [bar(48)] })
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
    const { rerender } = setup({ points: [bar(33)] })
    expect(screen.getByTestId('cue-detail-to-call')).toHaveTextContent('1 bar to the CALL')
    rerender({ points: [bar(40) + 1000] })
    expect(screen.getByTestId('cue-detail-to-call')).toHaveTextContent('8.5 bars to the CALL')
  })

  it('says nothing about a CALL when none lies ahead', () => {
    setup({ points: [bar(8)] })
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

  it('snaps the playhead to the nearest beat while the wave is dragged and on release, so it always rests on a beat', () => {
    const { onScrub } = setup()
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 400 })
    fireEvent.mouseMove(window, { clientX: 296 })
    expect(onScrub).toHaveBeenLastCalledWith(bar(32) + 8500)
    fireEvent.mouseMove(window, { clientX: 290 })
    fireEvent.mouseUp(window, { clientX: 290 })
    expect(onScrub.mock.calls.every(([ms]) => ms % 500 === 0)).toBe(true)
  })

  it('scrubs once per beat within one drag, so playing audio is not sent back to the same beat on every small move', () => {
    const { onScrub } = setup()
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 400 })
    fireEvent.mouseMove(window, { clientX: 300 })
    fireEvent.mouseMove(window, { clientX: 299.5 })
    fireEvent.mouseMove(window, { clientX: 300.4 })
    expect(onScrub.mock.calls).toEqual([[bar(32) + 8000]])
    fireEvent.mouseMove(window, { clientX: 290 })
    fireEvent.mouseUp(window, { clientX: 290 })
    expect(onScrub.mock.calls).toEqual([[bar(32) + 8000], [bar(32) + 9000]])
  })

  it('places on the bar under a click and still scrubs with a drag when a flow is chosen', () => {
    const onPlace = vi.fn<(ms: number) => void>()
    const { onScrub } = setup({ onPlace })
    const stage = screen.getByTestId('cue-detail')
    fireEvent.mouseDown(stage, { button: 0, clientX: 310 })
    fireEvent.mouseMove(window, { clientX: 312 })
    fireEvent.mouseUp(window, { clientX: 312 })
    expect(onPlace).toHaveBeenCalledWith(bar(36))
    expect(onScrub).not.toHaveBeenCalled()
    fireEvent.mouseDown(stage, { button: 0, clientX: 400 })
    fireEvent.mouseMove(window, { clientX: 300 })
    fireEvent.mouseUp(window, { clientX: 300 })
    expect(onScrub).toHaveBeenLastCalledWith(bar(32) + 8000)
    expect(onPlace).toHaveBeenCalledTimes(1)
  })

  it('never places on a press that starts on a mark, which belongs to its ✕ and its menu', () => {
    const onPlace = vi.fn<(ms: number) => void>()
    setup({ onPlace, cues: [{ key: 'b', ms: bar(36), kind: 2, color: 22, pending: false }] })
    fireEvent.mouseDown(screen.getByTestId('cue-detail-hot-B'), { button: 0, clientX: 300 })
    fireEvent.mouseUp(window, { clientX: 300 })
    expect(onPlace).not.toHaveBeenCalled()
  })

  it('draws a thin line on the bar under the cursor and hands it on, and none without a flow', () => {
    const onHover = vi.fn<(ms: number | null) => void>()
    const { rerender } = setup({ onHover })
    fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 310 })
    expect(screen.queryByTestId('cue-detail-cursor')).toBeNull()
    expect(onHover).not.toHaveBeenCalled()
    rerender({ onHover, onPlace: vi.fn<(ms: number) => void>() })
    fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 310 })
    expect(onHover).toHaveBeenLastCalledWith(bar(36))
    expect(screen.getByTestId('cue-detail-cursor').style.left).toBe('75%')
    expect(screen.getByTestId('cue-detail-cursor')).toHaveStyle({
      borderLeftStyle: 'dashed',
      borderLeftColor: 'var(--color-accent)',
    })
    fireEvent.mouseLeave(screen.getByTestId('cue-detail'))
    expect(onHover).toHaveBeenLastCalledWith(null)
    expect(screen.queryByTestId('cue-detail-cursor')).toBeNull()
  })

  it('takes the line under the cursor away once the editor stops placing, so Manual never shows where a flow would go', () => {
    const { rerender } = setup({ onPlace: vi.fn<(ms: number) => void>() })
    fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 310 })
    expect(screen.getByTestId('cue-detail-cursor')).toBeInTheDocument()
    rerender({ onPlace: undefined })
    expect(screen.queryByTestId('cue-detail-cursor')).toBeNull()
  })

  it('forgets the bar under the cursor as soon as a press starts, so no flow hangs over a scrub', () => {
    const onHover = vi.fn<(ms: number | null) => void>()
    const onScrub = vi.fn<(ms: number) => void>()
    setup({ onHover, onScrub, onPlace: vi.fn<(ms: number) => void>() })
    fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 310 })
    expect(onHover).toHaveBeenLastCalledWith(bar(36))
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 310 })
    fireEvent.mouseMove(window, { clientX: 200 })
    fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 200 })
    expect(onScrub).toHaveBeenCalled()
    expect(onHover).toHaveBeenLastCalledWith(null)
    expect(screen.queryByTestId('cue-detail-cursor')).toBeNull()
    fireEvent.mouseUp(window, { clientX: 200 })
  })

  it('draws the flow see-through and dims what it would take away', () => {
    setup({
      cues: [{ key: 'b', ms: bar(30), kind: 2, color: 22, pending: false }],
      ghost: {
        added: [
          { key: 'g', ms: bar(36), kind: 1, color: 42 },
          { key: 'gc', ms: bar(36), kind: 0, color: null },
        ],
        gone: ['b'],
      },
    })
    expect(screen.getByTestId('cue-detail-ghost-hot-A')).toHaveStyle({ opacity: '0.42' })
    expect(screen.getByTestId(`cue-detail-ghost-call-${bar(36)}`)).toHaveStyle({
      opacity: '0.42',
    })
    expect(screen.getByTestId('cue-detail-hot-B')).toHaveAttribute('data-gone', 'true')
    expect(screen.getByTestId('cue-detail-hot-B')).toHaveStyle({ opacity: '0.3' })
  })

  it('hands a point’s CALL dragged on the zoomed wave over at the quantized bar, without scrubbing, and ignores a press that never moves', () => {
    const onMoveMark = vi.fn<(key: string, ms: number) => void>()
    const { onScrub } = setup({
      cues: [
        { key: 'p', ms: bar(36), kind: 0, color: null, pending: false },
        { key: 'q', ms: bar(28), kind: 0, color: null, pending: false },
      ],
      movable: ['p'],
      onMoveMark,
    })
    const call = screen.getByTestId(`cue-detail-call-${bar(36)}`)
    fireEvent.mouseDown(call, { button: 0, clientX: 300 })
    fireEvent.mouseMove(window, { clientX: 302 })
    fireEvent.mouseUp(window, { clientX: 302 })
    expect(onMoveMark).not.toHaveBeenCalled()
    fireEvent.mouseDown(call, { button: 0, clientX: 300 })
    fireEvent.mouseMove(window, { clientX: 352 })
    expect(screen.getByTestId('cue-detail-drag-ghost').style.left).toBe('87.5%')
    fireEvent.mouseUp(window, { clientX: 352 })
    expect(onMoveMark).toHaveBeenCalledWith('p', bar(38))
    expect(onScrub).not.toHaveBeenCalled()
    fireEvent.mouseDown(screen.getByTestId(`cue-detail-call-${bar(28)}`), {
      button: 0,
      clientX: 200,
    })
    fireEvent.mouseMove(window, { clientX: 100 })
    fireEvent.mouseUp(window, { clientX: 100 })
    expect(onMoveMark).toHaveBeenCalledTimes(1)
    expect(onScrub).toHaveBeenCalled()
  })

  it('draws no flow under the cursor while a CALL is being dragged, and says when the drag starts and ends', () => {
    const onHover = vi.fn<(ms: number | null) => void>()
    const onMarkDrag = vi.fn<(dragging: boolean) => void>()
    setup({
      cues: [{ key: 'p', ms: bar(36), kind: 0, color: null, pending: false }],
      movable: ['p'],
      onMoveMark: vi.fn(),
      onPlace: vi.fn(),
      onHover,
      onMarkDrag,
    })
    fireEvent.mouseDown(screen.getByTestId(`cue-detail-call-${bar(36)}`), {
      button: 0,
      clientX: 300,
    })
    expect(onMarkDrag).toHaveBeenLastCalledWith(true)
    fireEvent.mouseMove(window, { clientX: 340 })
    fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 340 })
    expect(screen.queryByTestId('cue-detail-cursor')).toBeNull()
    expect(onHover).toHaveBeenLastCalledWith(null)
    fireEvent.mouseUp(window, { clientX: 340 })
    expect(onMarkDrag).toHaveBeenLastCalledWith(false)
  })

  it('drops a dragged CALL by the window it was grabbed in, even if the zoom or the playhead change during the drag', () => {
    const onMoveMark = vi.fn<(key: string, ms: number) => void>()
    const { rerender } = setup({
      cues: [{ key: 'p', ms: bar(36), kind: 0, color: null, pending: false }],
      movable: ['p'],
      onMoveMark,
    })
    fireEvent.mouseDown(screen.getByTestId(`cue-detail-call-${bar(36)}`), {
      button: 0,
      clientX: 300,
    })
    rerender({
      cues: [{ key: 'p', ms: bar(36), kind: 0, color: null, pending: false }],
      movable: ['p'],
      onMoveMark,
      bars: 32,
      playheadMs: bar(33),
    })
    fireEvent.mouseMove(window, { clientX: 352 })
    fireEvent.mouseUp(window, { clientX: 352 })
    expect(onMoveMark).toHaveBeenCalledWith('p', bar(38))
  })

  it('draws two dropped cues at one position without a key clash', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    setup({
      ghost: {
        added: [],
        gone: [],
        rejected: [
          { ms: bar(28), place: 'hot', color: 22 },
          { ms: bar(28), place: 'call', color: null },
        ],
      },
    })
    expect(error.mock.calls.flat().join(' ')).not.toContain('same key')
    error.mockRestore()
  })

  it('stacks zoom in, reset and zoom out at the left of the zoomed wave, outside it so they never take a wave click', () => {
    const onZoomReset = vi.fn<() => void>()
    const { onZoom } = setup({ onZoomReset })
    const ids = ['cue-zoom-in', 'cue-zoom-reset', 'cue-zoom-out']
    const buttons = ids.map((id) => screen.getByTestId(id))
    for (const b of buttons) expect(screen.getByTestId('cue-detail')).not.toContainElement(b)
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Zoom in',
      'Reset zoom',
      'Zoom out',
    ])
    expect(
      buttons[0].compareDocumentPosition(buttons[2]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getByTestId('cue-zoom-reset')).toBeDisabled()
    fireEvent.click(screen.getByTestId('cue-zoom-in'))
    fireEvent.click(screen.getByTestId('cue-zoom-out'))
    expect(onZoom.mock.calls).toEqual([['in'], ['out']])
  })

  it('disables + and − at the ends of the zoom and offers reset away from the default, never hiding any', () => {
    const onZoomReset = vi.fn<() => void>()
    const { rerender } = setup({ bars: 4, onZoomReset })
    expect(screen.getByTestId('cue-zoom-in')).toBeDisabled()
    expect(screen.getByTestId('cue-zoom-out')).toBeEnabled()
    fireEvent.click(screen.getByTestId('cue-zoom-reset'))
    expect(onZoomReset).toHaveBeenCalledTimes(1)
    rerender({ bars: 64 })
    expect(screen.getByTestId('cue-zoom-in')).toBeEnabled()
    expect(screen.getByTestId('cue-zoom-out')).toBeDisabled()
  })

  it('draws what the flow drops as faint dashed outlines in the cue colour, inside the window only and never clickable', () => {
    setup({
      ghost: {
        added: [],
        gone: [],
        rejected: [
          { ms: bar(28), place: 'both', color: 22 },
          { ms: bar(36), place: 'call', color: null },
          { ms: bar(4), place: 'hot', color: 42 },
        ],
      },
    })
    const hot = screen.getByTestId(`cue-detail-ghost-dropped-${bar(28)}`)
    expect(hot).toHaveStyle({ borderStyle: 'dashed', borderColor: hotCueColor(22), opacity: '0.3' })
    expect(hot.className).toContain('pointer-events-none')
    expect(screen.getByTestId(`cue-detail-ghost-dropped-${bar(36)}`)).toHaveStyle({
      borderColor: MEMORY_CUE_COLOR,
    })
    expect(screen.queryByTestId(`cue-detail-ghost-dropped-${bar(4)}`)).toBeNull()
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

  it('puts no buttons over the wave itself, the zoom buttons sit beside it', () => {
    setup()
    expect(within(screen.getByTestId('cue-detail')).queryAllByRole('button')).toHaveLength(0)
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

  it('shows a crosshair over the wave when a flow is chosen, so the click reads as placing and not as grabbing', () => {
    const { rerender } = setup()
    expect(screen.getByTestId('cue-detail').style.cursor).toBe('grab')
    rerender({ onPlace: vi.fn<(ms: number) => void>() })
    expect(screen.getByTestId('cue-detail').style.cursor).toBe('crosshair')
  })
  it('draws the marks in front of the playhead, which starts below the marks lane', () => {
    setup({
      cues: [
        { key: 'b', ms: bar(32), kind: 2, color: 22, pending: false },
        { key: 'p', ms: bar(32), kind: 0, color: null, pending: false },
      ],
    })
    const playhead = screen.getByTestId('cue-detail-playhead')
    expect(playhead.style.top).toBe(`${WAVE_MARK_LANE_PX}px`)
    for (const id of ['cue-detail-hot-B', `cue-detail-call-${bar(32)}`]) {
      const mark = screen.getByTestId(id)
      expect(playhead.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(mark.className).toContain('z-10')
    }
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
