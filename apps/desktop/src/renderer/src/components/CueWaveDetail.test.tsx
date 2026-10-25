// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { RotateCcw, Search } from 'lucide-react'
import { hotCueColor, MEMORY_CUE_COLOR } from '../../../shared/rekordboxCueColors'
import { HOT_MARK_PX, WAVE_MARK_LANE_PX } from '../lib/cueMarks'
import { CueWaveDetail, CueZoom } from './CueWaveDetail'

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
  return { onScrub, onZoom, rerender, unmount: view.unmount, container: view.container }
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

  it('draws every bar downbeat as a red line like rekordbox, where the grid itself says beat 1 and not counted from its first beat, with nothing that reads as a CALL triangle', () => {
    const probe = document.createElement('i')
    probe.style.color = MEMORY_CUE_COLOR
    const red = probe.style.color
    const shifted = Array.from({ length: 800 }, (_, i) => ({
      ms: i * 500,
      beat: ((i + 2) % 4) + 1,
    }))
    for (const compact of [false, true]) {
      const view = setup({ grid: shifted, playheadMs: bar(33), compact, quantize: 'beat' })
      const lines = screen.getAllByTestId('cue-detail-bar')
      expect(lines.length).toBeGreaterThan(10)
      const downbeats = shifted.filter((b) => b.beat === 1).map((b) => b.ms)
      for (const line of lines) {
        expect(downbeats).toContain(Number(line.dataset.ms))
        expect(line.style.backgroundColor).toBe(red)
        expect(Number(line.style.opacity)).toBeGreaterThanOrEqual(0.25)
        expect(Number(line.style.opacity)).toBeLessThanOrEqual(0.35)
        expect(line.style.width).toBe('1px')
        expect(line.childElementCount).toBe(0)
      }
      expect(new Set(lines.map((l) => (Number(l.dataset.ms) / 500) % 4))).toEqual(new Set([2]))
      const ticks = screen.getAllByTestId('cue-detail-beat')
      for (const tick of ticks) expect(tick.style.backgroundColor).toBe('')
      const tinted = [...view.container.querySelectorAll<HTMLElement>('*')].filter((el) =>
        [el.style.backgroundColor, el.style.borderTopColor, el.style.borderBottomColor].includes(
          red,
        ),
      )
      expect(tinted).toEqual(lines)
      view.unmount()
    }
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

  it('places on the quantized bar under a click, a hand shake included, and only scrubs with a real drag, never moving the playhead on a click', () => {
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

  it('does nothing on a click without a flow to place, as in Manual', () => {
    const { onScrub } = setup()
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 310 })
    fireEvent.mouseUp(window, { clientX: 310 })
    expect(onScrub).not.toHaveBeenCalled()
  })

  it('never places on a press that starts on a mark, which belongs to its ✕ and its menu', () => {
    const onPlace = vi.fn<(ms: number) => void>()
    setup({ onPlace, cues: [{ key: 'b', ms: bar(36), kind: 2, color: 22, pending: false }] })
    fireEvent.mouseDown(screen.getByTestId('cue-detail-hot-B'), { button: 0, clientX: 300 })
    fireEvent.mouseUp(window, { clientX: 300 })
    expect(onPlace).not.toHaveBeenCalled()
  })

  it('hands the quantized bar under the pointer on, and forgets it when the pointer leaves or a press starts, so the flow follows the pointer only while hovering', () => {
    const onHover = vi.fn<(ms: number | null) => void>()
    setup({ onHover, onPlace: vi.fn<(ms: number) => void>() })
    const stage = screen.getByTestId('cue-detail')
    fireEvent.mouseMove(stage, { clientX: 310 })
    expect(onHover).toHaveBeenLastCalledWith(bar(36))
    fireEvent.mouseLeave(stage)
    expect(onHover).toHaveBeenLastCalledWith(null)
    fireEvent.mouseMove(stage, { clientX: 310 })
    fireEvent.mouseDown(stage, { button: 0, clientX: 310 })
    expect(onHover).toHaveBeenLastCalledWith(null)
    fireEvent.mouseUp(window, { clientX: 310 })
  })

  it('hands nothing on while hovering without a flow to place', () => {
    const onHover = vi.fn<(ms: number | null) => void>()
    setup({ onHover })
    fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 310 })
    expect(onHover).not.toHaveBeenCalledWith(bar(36))
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
    const ghost = screen.getByTestId('cue-detail-ghost-hot-A')
    const fill = ghost.querySelector<HTMLElement>('[data-ghost-fill]')
    expect(ghost).toHaveTextContent(/^[A-H]$/)
    expect(ghost.style.borderStyle).not.toBe('dashed')
    expect(ghost.style.opacity).toBe('')
    expect(ghost.style.backgroundColor).not.toBe('')
    expect(fill).toHaveStyle({ backgroundColor: hotCueColor(42), opacity: '0.5' })
    expect(screen.getByTestId(`cue-detail-ghost-call-${bar(36)}`)).toHaveStyle({
      opacity: '0.5',
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

  it('says when a CALL drag starts and ends, so the editor hides the flow meanwhile', () => {
    const onMarkDrag = vi.fn<(dragging: boolean) => void>()
    setup({
      cues: [{ key: 'p', ms: bar(36), kind: 0, color: null, pending: false }],
      movable: ['p'],
      onMoveMark: vi.fn(),
      onMarkDrag,
    })
    fireEvent.mouseDown(screen.getByTestId(`cue-detail-call-${bar(36)}`), {
      button: 0,
      clientX: 300,
    })
    expect(onMarkDrag).toHaveBeenLastCalledWith(true)
    fireEvent.mouseMove(window, { clientX: 340 })
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

  it('lays out zoom out, reset and zoom in left to right, as the bar count grows that way', () => {
    const onZoom = vi.fn<(dir: 'in' | 'out') => void>()
    render(<CueZoom row bars={16} onZoom={onZoom} onReset={vi.fn<() => void>()} />)
    const ids = ['cue-zoom-out', 'cue-zoom-reset', 'cue-zoom-in']
    const buttons = ids.map((id) => screen.getByTestId(id))
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Zoom out',
      'Reset zoom',
      'Zoom in',
    ])
    expect(
      buttons[0].compareDocumentPosition(buttons[2]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getByTestId('cue-zoom-reset')).toBeDisabled()
    fireEvent.click(screen.getByTestId('cue-zoom-in'))
    fireEvent.click(screen.getByTestId('cue-zoom-out'))
    expect(onZoom.mock.calls).toEqual([['in'], ['out']])
  })

  it('draws the zoom reset as a magnifier, never a turning arrow, since Vicent read the arrow as undo', () => {
    render(<CueZoom row bars={8} onZoom={vi.fn()} onReset={vi.fn<() => void>()} />)
    const drawn = (icon: React.ReactElement) => render(icon).container.innerHTML
    const reset = screen.getByTestId('cue-zoom-reset').innerHTML
    expect(reset).toBe(drawn(<Search className="h-3.5 w-3.5" aria-hidden="true" />))
    expect(reset).not.toBe(drawn(<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />))
  })

  it('disables + and − at the ends of the zoom and offers reset away from the default, never hiding any', () => {
    const onReset = vi.fn<() => void>()
    const { rerender } = render(<CueZoom row bars={4} onZoom={vi.fn()} onReset={onReset} />)
    expect(screen.getByTestId('cue-zoom-in')).toBeDisabled()
    expect(screen.getByTestId('cue-zoom-out')).toBeEnabled()
    fireEvent.click(screen.getByTestId('cue-zoom-reset'))
    expect(onReset).toHaveBeenCalledTimes(1)
    rerender(<CueZoom row bars={64} onZoom={vi.fn()} onReset={onReset} />)
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

  it('paints one column per device pixel of the drawn strip however long the track, a peak and a body each', () => {
    const fillRect = vi.fn()
    const fake = { clearRect: vi.fn(), fillRect, setTransform: vi.fn(), fillStyle: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake as never)
    const words = new Uint16Array(45000).fill((7 << 13) | (31 << 2))
    setup({ source: { words }, playheadMs: 150000 })
    const canvas = screen.getByTestId('cue-detail').querySelector('canvas') as HTMLCanvasElement
    expect(fillRect.mock.calls).toHaveLength(canvas.width * 2)
  })

  it('paints the short folded wave from the same detailed wave and with the same columns as full screen at the same zoom', () => {
    const counts: number[] = []
    for (const compact of [false, true]) {
      const fillRect = vi.fn()
      const fake = { clearRect: vi.fn(), fillRect, setTransform: vi.fn(), fillStyle: '' }
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake as never)
      const words = new Uint16Array(45000).fill((7 << 13) | (31 << 2))
      const view = setup({ source: { words }, playheadMs: 150000, compact })
      counts.push(fillRect.mock.calls.length)
      view.unmount()
    }
    expect(counts[0]).toBeGreaterThan(300)
    expect(counts[1]).toBe(counts[0])
  })

  it('paints the wave in Surco colours, a faint ink peak under an accent body like the home scenes, not in rekordbox colours', () => {
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
    const tokens: Record<string, string> = {
      '--color-accent': '#7aa2f7',
      '--color-fg-faint': '#838bb2',
    }
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) => tokens[name] ?? '',
    } as never)
    const words = new Uint16Array(45000).fill((7 << 13) | (31 << 2))
    setup({ source: { words }, playheadMs: 150000 })
    expect(styles).toEqual(['#838bb2', '#7aa2f7'])
  })

  it('neither resizes nor repaints the canvas while only the playhead moves, it slides the strip it already drew, since repainting every frame made the playing wave flicker and cost frames', () => {
    const fake = { clearRect: vi.fn(), fillRect: vi.fn(), setTransform: vi.fn(), fillStyle: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake as never)
    const watchers: (() => void)[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          watchers.push(callback)
        }
        observe() {}
        disconnect() {}
      },
    )
    const words = new Uint16Array(45000).fill((7 << 13) | (31 << 2))
    const { rerender } = setup({ source: { words }, playheadMs: 150000 })
    const canvas = screen.getByTestId('cue-detail').querySelector('canvas') as HTMLCanvasElement
    const sizes: number[] = []
    for (const side of ['width', 'height'] as const) {
      const own = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, side)
      Object.defineProperty(canvas, side, {
        configurable: true,
        get: () => own?.get?.call(canvas),
        set: (v: number) => {
          sizes.push(v)
          own?.set?.call(canvas, v)
        },
      })
    }
    const left = canvas.style.left
    for (const ms of [150500, 151000, 151500]) rerender({ source: { words }, playheadMs: ms })
    expect(sizes).toEqual([])
    expect(watchers).toHaveLength(1)
    expect(fake.clearRect).toHaveBeenCalledTimes(1)
    expect(canvas.style.left).not.toBe(left)
    rerender({ source: { words }, playheadMs: 150000 + bar(20) })
    expect(fake.clearRect).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })

  it('paints one column per device pixel on a Retina screen, so a zoomed wave never stretches one entry into blocks', () => {
    vi.stubGlobal('devicePixelRatio', 2)
    const fillRect = vi.fn()
    const setTransform = vi.fn()
    const fake = { clearRect: vi.fn(), fillRect, setTransform, fillStyle: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake as never)
    const words = new Uint16Array(45000).fill((7 << 13) | (31 << 2))
    setup({ source: { words }, playheadMs: 150000 })
    const canvas = screen.getByTestId('cue-detail').querySelector('canvas') as HTMLCanvasElement
    expect(canvas.width).toBe(400 * 3 * 2)
    expect(canvas.height).toBe(320)
    expect(canvas.style.width).toBe('300%')
    const xs = fillRect.mock.calls.map(([x]) => x)
    expect(new Set(xs).size).toBe(canvas.width)
    expect(fillRect.mock.calls.every(([, , w]) => w === 1)).toBe(true)
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

  it('draws an unsaved cue filled exactly like a saved one, since only the header says what is unsaved', () => {
    setup({
      cues: [
        { key: 'b', ms: bar(36), kind: 2, color: 22, pending: true },
        { key: 'a', ms: bar(34), kind: 1, color: 22, pending: false },
        { key: 'd', ms: bar(40), kind: 0, color: null, pending: true },
        { key: 'e', ms: bar(34), kind: 0, color: null, pending: false },
      ],
    })
    const unsaved = screen.getByTestId('cue-detail-hot-B')
    const saved = screen.getByTestId('cue-detail-hot-A')
    expect(unsaved.style.backgroundColor).toBe(saved.style.backgroundColor)
    expect(unsaved.style.borderColor).toBe('')
    expect(unsaved.className).toBe(saved.className)
    expect(screen.getByTestId(`cue-detail-call-${bar(40)}`).className).toBe(
      screen.getByTestId(`cue-detail-call-${bar(34)}`).className,
    )
  })

  it('draws no preview over a cue already in place, neither a see-through twin nor a dashed outline', () => {
    setup({
      cues: [
        { key: 'a', ms: bar(34), kind: 1, color: 22, pending: true },
        { key: 'c', ms: bar(34), kind: 0, color: null, pending: true },
      ],
      ghost: {
        added: [
          { key: 'g1', ms: bar(34), kind: 1, color: 22 },
          { key: 'g2', ms: bar(34), kind: 0, color: null },
          { key: 'g3', ms: bar(36), kind: 2, color: 42 },
        ],
        gone: [],
        rejected: [{ ms: bar(34), place: 'both', color: 22 }],
      },
    })
    expect(screen.queryByTestId(`cue-detail-ghost-call-${bar(34)}`)).toBeNull()
    expect(screen.queryByTestId(`cue-detail-ghost-dropped-${bar(34)}`)).toBeNull()
    expect(screen.queryAllByTestId(/^cue-detail-ghost-hot-/).map((el) => el.style.left)).toEqual([
      screen.getByTestId('cue-detail-ghost-hot-B').style.left,
    ])
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

  it('keeps the zoomed wave a calm 200px however tall the window, since a wave filling the screen read as coarse rather than clean', () => {
    setup()
    const stage = screen.getByTestId('cue-detail')
    expect(stage.style.height).toBe('200px')
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

  it('shows a crosshair over the wave when a click places the flow, and a hand when a press can only scrub', () => {
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
