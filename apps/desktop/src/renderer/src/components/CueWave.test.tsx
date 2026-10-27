// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { Api } from '../../../preload/api'
import { hotCueColor } from '../../../shared/rekordboxCueColors'
import { resetRowWaves } from '../lib/rowWaves'
import { CueWave } from './CueWave'
import { RowWave } from './RowWave'

afterEach(cleanup)

const GRID = Array.from({ length: 160 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 80,
    right: 800,
    bottom: 80,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

function setup(over: Partial<React.ComponentProps<typeof CueWave>> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onMenu: vi.fn(),
  }
  render(
    <CueWave
      wave={[{ h: 1, rgb: [255, 0, 0] }]}
      grid={GRID}
      durationMs={80000}
      cues={[
        { key: 'a', ms: 16000, kind: 1, color: 42, pending: false },
        { key: 'p', ms: 16000, kind: 0, color: null, pending: false },
        { key: 'd', ms: 40000, kind: 0, color: null, pending: true },
      ]}
      {...handlers}
      {...over}
    />,
  )
  return handlers
}

describe('CueWave', () => {
  it('draws the overview with the list row’s own mirrored bars, accent and opacity, so the two waves read as one', async () => {
    ;(window as unknown as { api: Partial<Api> }).api = {
      rowWaves: vi.fn<Api['rowWaves']>(async () => ({ '/a.DAT': [1, 0.5, 0] })),
    }
    render(
      <RowWave
        request={{ path: '/m/a.wav', analysisPath: '/a.DAT' }}
        cues={[]}
        durationSec={128}
        pending={false}
        active
      />,
    )
    const row = await screen.findByTestId('track-wave-bars')
    setup({
      wave: [
        { h: 1, rgb: [255, 0, 0] },
        { h: 0.5, rgb: null },
        { h: 0, rgb: null },
      ],
    })
    const strip = screen.getByTestId('cue-wave-bars')
    expect(strip.getAttribute('viewBox')).toBe(row.getAttribute('viewBox'))
    expect(strip.querySelector('path')?.getAttribute('d')).toBe(
      row.querySelector('path')?.getAttribute('d'),
    )
    expect(strip.querySelector('path')?.getAttribute('fill')).toBe('var(--color-accent)')
    expect(strip.getAttribute('opacity')).toBe(row.getAttribute('opacity'))
    resetRowWaves()
  })

  it('thins a long wave to slim bars with gaps, keeping each bar’s loudest column so no peak is lost', () => {
    const wave = Array.from({ length: 1200 }, (_, i) => ({ h: i === 601 ? 1 : 0.2, rgb: null }))
    setup({ wave })
    const d = screen.getByTestId('cue-wave-bars').querySelector('path')?.getAttribute('d') ?? ''
    const bars = d.split('Z').filter(Boolean)
    expect(bars.length).toBeLessThanOrEqual(300)
    expect(bars.filter((b) => b.includes('v20'))).toHaveLength(1)
  })

  it('draws as many bars as fit at the list row’s bar pitch, so a wide strip is not thicker than the row', () => {
    const wave = Array.from({ length: 1200 }, () => ({ h: 0.5, rgb: null }))
    const rect = (width: number) =>
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width,
        height: 80,
        right: width,
        bottom: 80,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      })
    const barsAt = (width: number) => {
      rect(width)
      const view = render(<CueWave wave={wave} grid={GRID} durationMs={80000} cues={[]} />)
      const d = screen.getByTestId('cue-wave-bars').querySelector('path')?.getAttribute('d') ?? ''
      const count = d.split('Z').filter(Boolean).length
      view.unmount()
      return count
    }
    expect(barsAt(600)).toBe(200)
    expect(barsAt(1200)).toBe(400)
  })

  it('puts the marks on the strip’s top edge over the wave, as the list row does, with the wave filling the rest', () => {
    setup()
    expect(screen.getByTestId('cue-wave-hot-A').style.top).toBe('0px')
    expect(screen.getByTestId('cue-wave-call-16000').style.top).toBe('0px')
    expect(screen.getByTestId('cue-wave-area').style.top).toBe('0px')
    expect(screen.getByTestId('cue-wave-area').style.bottom).toBe('0px')
    expect(screen.getByTestId('cue-wave-bars').style.height).toBe('90%')
  })

  it('draws a scale tick at the bottom every 32 beats from the grid, a rekordbox phrase, stronger every 128 beats', () => {
    setup()
    expect(screen.queryAllByTestId('cue-wave-bar')).toHaveLength(0)
    const ticks = screen.getAllByTestId('cue-wave-tick')
    expect(ticks.map((t) => [t.style.left, t.dataset.strong])).toEqual([
      ['0%', 'true'],
      ['20%', 'false'],
      ['40%', 'false'],
      ['60%', 'false'],
      ['80%', 'true'],
    ])
    for (const t of ticks) {
      expect(t.className).toContain('bottom-0')
      expect(t.closest('[data-testid="cue-wave-area"]')).toHaveClass('pointer-events-none')
    }
    expect(ticks[0].className).not.toBe(ticks[1].className)
  })

  it('counts the phrases of the scale from the first downbeat of the grid, as the zoomed wave counts its caps', () => {
    const offset = [
      { ms: 0, beat: 3 },
      { ms: 500, beat: 4 },
      ...GRID.map((b) => ({ ms: b.ms + 1000, beat: b.beat })),
    ]
    setup({ grid: offset })
    expect(screen.getAllByTestId('cue-wave-tick')[0].style.left).toBe('1.25%')
  })

  it('selects a cue with a click on its square without marking a drop there', () => {
    const h = setup()
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-A'), { clientX: 160 })
    fireEvent.mouseUp(window, { clientX: 160 })
    fireEvent.click(screen.getByTestId('cue-wave-hot-A'), { clientX: 160 })
    expect(h.onSelect).toHaveBeenCalledWith('a')
  })

  it('draws a proposal as a bare line under a mark at the same place, since it is accepted from its pill on the zoomed wave', () => {
    setup({ proposals: [16000] })
    const all = screen.getAllByTestId(/^cue-wave-(proposal|hot)-/)
    expect(all.map((e) => e.dataset.testid)).toEqual(['cue-wave-proposal-16000', 'cue-wave-hot-A'])
    expect(screen.getByTestId('cue-wave-proposal-16000')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('cue-wave-proposal-16000').style.left).toBe('20%')
  })

  it('opens the menu on a right-click with the beat under it', () => {
    const h = setup()
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 30 })
    expect(h.onMenu).toHaveBeenCalledWith({ ms: 10000, x: 100, y: 30 })
  })

  it('quantizes the menu to the bar start when quantizing to the bar', () => {
    const h = setup({ quantize: 'bar' })
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: 105, clientY: 30 })
    expect(h.onMenu).toHaveBeenCalledWith({ ms: 10000, x: 105, y: 30 })
  })

  it('draws the hot cues the 8 limit left out apart, so the user sees them', () => {
    setup({ trimmed: [8000] })
    expect(screen.getByTestId('cue-wave-trimmed-8000')).toBeInTheDocument()
  })

  it('marks the selected cue', () => {
    setup({ selected: 'a' })
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-selected', 'true')
  })

  it('takes no clicks, drags or menus read-only, as in the settings preview', () => {
    const h = setup({ readOnly: true })
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 60 })
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-A'), { clientX: 160 })
    fireEvent.mouseUp(window, { clientX: 300 })
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 30 })
    expect(Object.values(h).every((f) => f.mock.calls.length === 0)).toBe(true)
  })

  it('says the track is not analysed and takes no clicks when it has no grid', () => {
    const onSeek = vi.fn<(ms: number) => void>()
    setup({ grid: [], onSeek })
    expect(screen.getByTestId('cue-wave-not-analysed')).toBeInTheDocument()
    expect(screen.queryByTestId('cue-wave')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-wave-not-analysed'), { clientX: 100, clientY: 40 })
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('moves the playhead with a press, so the strip always navigates', () => {
    const onSeek = vi.fn<(ms: number) => void>()
    setup({ onSeek, playheadMs: 20000 })
    expect(screen.getByTestId('cue-wave-playhead').style.left).toBe('25%')
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 400 })
    fireEvent.mouseUp(window, { clientX: 400 })
    expect(onSeek).toHaveBeenCalledWith(40000)
  })

  it('snaps the playhead to the nearest beat when the strip is clicked or dragged', () => {
    const onSeek = vi.fn<(ms: number) => void>()
    setup({ onSeek, playheadMs: 0 })
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 403 })
    fireEvent.mouseMove(window, { clientX: 612 })
    fireEvent.mouseUp(window, { clientX: 612 })
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 403 })
    expect(onSeek.mock.calls).toEqual([[40500], [61000]])
  })

  it('seeks once per beat within one press, so playing audio is not sent back to the same beat on every small move or on the click that ends it', () => {
    const onSeek = vi.fn<(ms: number) => void>()
    setup({ onSeek, playheadMs: 0 })
    const strip = screen.getByTestId('cue-wave')
    fireEvent.mouseDown(strip, { button: 0, clientX: 403 })
    fireEvent.mouseMove(window, { clientX: 403.5 })
    fireEvent.mouseMove(window, { clientX: 404 })
    fireEvent.mouseMove(window, { clientX: 402.8 })
    fireEvent.mouseUp(window, { clientX: 402.8 })
    fireEvent.click(strip, { clientX: 402.8 })
    expect(onSeek.mock.calls).toEqual([[40500]])
    fireEvent.mouseDown(strip, { button: 0, clientX: 403 })
    fireEvent.mouseMove(window, { clientX: 409 })
    fireEvent.mouseUp(window, { clientX: 409 })
    fireEvent.click(strip, { clientX: 409 })
    expect(onSeek.mock.calls).toEqual([[40500], [40500], [41000]])
  })

  it('draws no playhead when it is given none, as the Settings preview', () => {
    setup()
    expect(screen.queryByTestId('cue-wave-playhead')).toBeNull()
  })

  it('draws no focus ring once Space is pressed on it, since the global keyboard ring of a focusable element showed as a blue line under the strip', () => {
    setup({ slim: true, onSeek: vi.fn() })
    const strip = screen.getByTestId('cue-wave')
    expect(strip.className).toContain('outline-none')
    expect(strip.className).toContain('focus-visible:shadow-none')
  })

  // The strip answers no key of its own: the cue editor around it owns the keyboard. As a
  // Tab stop it was a ringless stop where nothing happened; a click still focuses it.
  it('is no Tab stop of its own, since the cue editor around it handles the keys', () => {
    setup({ slim: true, onSeek: vi.fn() })
    expect(screen.getByTestId('cue-wave')).toHaveAttribute('tabindex', '-1')
  })

  // Every memory cue button read just "CALL", so a screen reader listing the strip heard
  // the same word once per cue with nothing to tell them apart. Each one names its time.
  it('names each memory cue by its time', () => {
    setup({
      cues: [
        { key: 'p', ms: 16000, kind: 0, color: null, pending: false },
        { key: 'q', ms: 64000, kind: 0, color: null, pending: false },
      ],
    })
    expect(screen.getByTestId('cue-wave-call-16000')).toHaveAccessibleName('CALL at 0:16')
    expect(screen.getByTestId('cue-wave-call-64000')).toHaveAccessibleName('CALL at 1:04')
  })

  it('draws as a slim strip without its own card when it shares a surface with the zoomed wave, its marks in a lane above the bars so none is cut', () => {
    setup({ slim: true })
    expect(screen.getByTestId('cue-wave').className).toContain('h-[44px]')
    expect(screen.getByTestId('cue-wave').className).not.toContain('rounded-md')
    expect(screen.getByTestId('cue-wave-bars').style.height).toBe('calc(100% - 14px)')
  })

  it('keeps the full editor overview a thin 44px card, so the zoomed wave stays the one large shape', () => {
    setup()
    expect(screen.getByTestId('cue-wave').className).toContain('h-11')
    expect(screen.getByTestId('cue-wave').className).toContain('rounded-md')
  })

  it('draws two dropped cues at one position without a key clash', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    setup({
      ghost: {
        added: [],
        gone: [],
        rejected: [
          { ms: 32000, place: 'hot', color: 22 },
          { ms: 32000, place: 'call', color: null },
        ],
      },
    })
    expect(error.mock.calls.flat().join(' ')).not.toContain('same key')
    error.mockRestore()
  })

  it('draws the cues the flow would add see-through and dims the ones it would take away, none of them clickable', () => {
    setup({
      ghost: {
        added: [
          { key: 'g1', ms: 32000, kind: 2, color: 22 },
          { key: 'g2', ms: 32000, kind: 0, color: null },
        ],
        gone: ['a'],
      },
    })
    const ghost = screen.getByTestId('cue-wave-ghost-hot-B')
    const fill = ghost.querySelector<HTMLElement>('[data-ghost-fill]')
    expect(ghost).toHaveTextContent(/^[A-H]$/)
    expect(ghost.style.borderStyle).not.toBe('dashed')
    expect(ghost.style.opacity).toBe('')
    expect(ghost.style.backgroundColor).not.toBe('')
    expect(fill).toHaveStyle({ backgroundColor: hotCueColor(22), opacity: '0.5' })
    expect(screen.getByTestId('cue-wave-ghost-hot-B').tagName).toBe('SPAN')
    expect(screen.getByTestId('cue-wave-ghost-call-32000')).toHaveStyle({ opacity: '0.5' })
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-gone', 'true')
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveStyle({ opacity: '0.3' })
    expect(screen.getByTestId('cue-wave-call-40000')).toHaveAttribute('data-gone', 'false')
  })

  it('draws an unsaved cue filled exactly like a saved one, since only the header says what is unsaved', () => {
    setup({
      cues: [
        { key: 'a', ms: 16000, kind: 1, color: 42, pending: false },
        { key: 'b', ms: 32000, kind: 2, color: 42, pending: true },
        { key: 'p', ms: 16000, kind: 0, color: null, pending: false },
        { key: 'd', ms: 40000, kind: 0, color: null, pending: true },
      ],
    })
    const unsaved = screen.getByTestId('cue-wave-hot-B')
    const saved = screen.getByTestId('cue-wave-hot-A')
    expect(unsaved.style.backgroundColor).toBe(saved.style.backgroundColor)
    expect(unsaved.style.borderColor).toBe('')
    expect(unsaved.className).toBe(saved.className)
    expect(screen.getByTestId('cue-wave-call-40000').className).toBe(
      screen.getByTestId('cue-wave-call-16000').className,
    )
  })

  it('draws no preview over a cue already in place, neither a see-through twin nor a dashed outline', () => {
    setup({
      ghost: {
        added: [
          { key: 'g1', ms: 16000, kind: 1, color: 42 },
          { key: 'g2', ms: 40000, kind: 0, color: null },
          { key: 'g3', ms: 32000, kind: 2, color: 22 },
        ],
        gone: [],
        rejected: [{ ms: 16000, place: 'both', color: 42 }],
      },
    })
    expect(screen.queryByTestId('cue-wave-ghost-hot-A')).toBeNull()
    expect(screen.queryByTestId('cue-wave-ghost-call-40000')).toBeNull()
    expect(screen.queryByTestId('cue-wave-ghost-dropped-16000')).toBeNull()
    expect(screen.getByTestId('cue-wave-ghost-hot-B')).toBeInTheDocument()
  })

  it('draws the overview from the detailed wave once it is loaded, one thin column per device pixel, like rekordbox overview', () => {
    vi.stubGlobal('devicePixelRatio', 2)
    const fillRect = vi.fn<(x: number, y: number, w: number, h: number) => void>()
    const fake = { clearRect: vi.fn(), fillRect, setTransform: vi.fn(), fillStyle: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake as never)
    const detail = new Uint16Array(12000).map((_, i) => (7 << 13) | ((i % 32) << 2))
    setup({ detail })
    expect(screen.queryByTestId('cue-wave-bars')).toBeNull()
    const canvas = screen.getByTestId('cue-wave-canvas') as HTMLCanvasElement
    expect(canvas.width).toBe(800 * 2)
    expect(new Set(fillRect.mock.calls.map(([x]) => x)).size).toBe(canvas.width)
    expect(fillRect.mock.calls.every(([, , w]) => w === 1)).toBe(true)
    vi.unstubAllGlobals()
  })

  // The canvas cannot follow CSS variables, so the colours are read when it paints. Read
  // only on new data or a resize, a theme switch left the overview in the old theme's
  // colours until the next track.
  it('repaints the overview in the new colours when the theme switches', async () => {
    const clearRect = vi.fn()
    const fake = { clearRect, fillRect: vi.fn(), setTransform: vi.fn(), fillStyle: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake as never)
    const root = document.documentElement
    root.style.setProperty('--color-accent', '#7aa2f7')
    try {
      setup({ detail: new Uint16Array(12000).fill((7 << 13) | (20 << 2)) })
      const painted = clearRect.mock.calls.length
      await act(async () => {
        root.style.setProperty('--color-accent', '#2959aa')
        root.setAttribute('data-theme', 'light')
      })
      expect(clearRect.mock.calls.length).toBeGreaterThan(painted)
    } finally {
      root.style.removeProperty('--color-accent')
      root.removeAttribute('data-theme')
    }
  })

  it('keeps the light overview bars until the detailed wave arrives', () => {
    setup({ detail: null })
    expect(screen.getByTestId('cue-wave-bars')).toBeInTheDocument()
    expect(screen.queryByTestId('cue-wave-canvas')).toBeNull()
  })

  it('does not repaint the overview while only the playhead moves', () => {
    const clearRect = vi.fn()
    const fake = { clearRect, fillRect: vi.fn(), setTransform: vi.fn(), fillStyle: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake as never)
    const detail = new Uint16Array(12000).fill((7 << 13) | (20 << 2))
    const cues = [{ key: 'a', ms: 16000, kind: 1, color: 42, pending: false }]
    const view = render(
      <CueWave
        wave={[{ h: 1, rgb: null }]}
        grid={GRID}
        durationMs={80000}
        cues={cues}
        detail={detail}
        playheadMs={0}
      />,
    )
    const drawn = clearRect.mock.calls.length
    expect(drawn).toBeGreaterThan(0)
    for (const ms of [500, 1000, 1500])
      view.rerender(
        <CueWave
          wave={[{ h: 1, rgb: null }]}
          grid={GRID}
          durationMs={80000}
          cues={cues}
          detail={detail}
          playheadMs={ms}
        />,
      )
    expect(clearRect.mock.calls.length).toBe(drawn)
  })

  it('shows the part the zoomed wave shows as a soft rectangle', () => {
    setup({
      onSeek: vi.fn<(ms: number) => void>(),
      playheadMs: 20000,
      view: { fromMs: 12000, toMs: 28000 },
    })
    expect(screen.getByTestId('cue-wave-view').style.left).toBe('15%')
    expect(screen.getByTestId('cue-wave-view').style.width).toBe('20%')
  })

  it('cuts the rectangle at the start of the track instead of drawing it off the strip', () => {
    setup({
      onSeek: vi.fn<(ms: number) => void>(),
      playheadMs: 0,
      view: { fromMs: -8000, toMs: 8000 },
    })
    expect(screen.getByTestId('cue-wave-view').style.left).toBe('0%')
    expect(screen.getByTestId('cue-wave-view').style.width).toBe('10%')
  })

  it('moves the playhead while the strip is dragged and stops on release', () => {
    const onSeek = vi.fn<(ms: number) => void>()
    setup({ onSeek, playheadMs: 0 })
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 400 })
    fireEvent.mouseUp(window, { clientX: 400 })
    fireEvent.mouseMove(window, { clientX: 600 })
    expect(onSeek.mock.calls).toEqual([[10000], [40000]])
  })

  it('moves the playhead and no mark when a drag starts on a mark, since the strip only navigates', () => {
    const onSeek = vi.fn<(ms: number) => void>()
    setup({ onSeek, playheadMs: 0 })
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-A'), { button: 0, clientX: 160 })
    fireEvent.mouseMove(window, { clientX: 243 })
    fireEvent.mouseUp(window, { clientX: 243 })
    expect(onSeek.mock.calls).toEqual([[16000], [24500]])
    expect(screen.queryByTestId('cue-wave-drag-ghost')).toBeNull()
  })

  it('opens the mark menu on a right-click on a hot cue or a CALL, without the strip menu', () => {
    const onMarkMenu = vi.fn()
    const h = setup({ onMarkMenu })
    const hot = screen.getByTestId('cue-wave-hot-A')
    fireEvent.mouseDown(hot, { button: 2, clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 300 })
    fireEvent.mouseUp(window)
    fireEvent.contextMenu(hot, { clientX: 120, clientY: 7 })
    expect(onMarkMenu).toHaveBeenCalledWith({ key: 'a', clientX: 120, clientY: 7 })
    fireEvent.contextMenu(screen.getByTestId('cue-wave-call-40000'), { clientX: 5, clientY: 6 })
    expect(onMarkMenu).toHaveBeenLastCalledWith({ key: 'd', clientX: 5, clientY: 6 })
    expect(h.onMenu).not.toHaveBeenCalled()
  })

  it('draws the marks after the playhead so they sit in front of it', () => {
    setup({ onSeek: vi.fn(), playheadMs: 16000 })
    const playhead = screen.getByTestId('cue-wave-playhead')
    for (const id of ['cue-wave-hot-A', 'cue-wave-call-40000']) {
      const mark = screen.getByTestId(id)
      expect(playhead.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(mark.className).toContain('z-10')
    }
  })
})
