// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { Api } from '../../../preload/api'
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
    onMove: vi.fn(),
    onMenu: vi.fn(),
    onAcceptProposal: vi.fn(),
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
    expect(h.onMove).not.toHaveBeenCalled()
  })

  it('drags a cue to the beat under the pointer', () => {
    const h = setup()
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-A'), { clientX: 160 })
    fireEvent.mouseMove(window, { clientX: 243 })
    expect(screen.getByTestId('cue-wave-drag-ghost')).toBeInTheDocument()
    fireEvent.mouseUp(window, { clientX: 243 })
    expect(h.onMove).toHaveBeenCalledWith('a', 24500)
  })

  it('does not arm a drag from a right-click or a ctrl-click, whose mouseup may never arrive', () => {
    const h = setup()
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-A'), { clientX: 160, button: 2 })
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-A'), { clientX: 160, ctrlKey: true })
    fireEvent.mouseMove(window, { clientX: 300 })
    fireEvent.mouseUp(window, { clientX: 300 })
    expect(h.onMove).not.toHaveBeenCalled()
    expect(screen.queryByTestId('cue-wave-drag-ghost')).toBeNull()
  })

  it('swallows the click that follows a mark drag so the release does not move the playhead too', () => {
    vi.useFakeTimers()
    const onSeek = vi.fn<(ms: number) => void>()
    setup({ onSeek, playheadMs: 0 })
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-A'), { clientX: 160 })
    fireEvent.mouseMove(window, { clientX: 243 })
    fireEvent.mouseUp(window, { clientX: 243 })
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 243 })
    expect(onSeek).not.toHaveBeenCalled()
    vi.runAllTimers()
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 100 })
    expect(onSeek).toHaveBeenCalledWith(10000)
    vi.useRealTimers()
  })

  it('keeps a proposal clickable under a mark at the same place', () => {
    setup({ proposals: [16000] })
    const all = screen.getAllByTestId(/^cue-wave-(proposal|hot)-/)
    expect(all.map((e) => e.dataset.testid)).toEqual(['cue-wave-proposal-16000', 'cue-wave-hot-A'])
  })

  it('draws the line under the cursor dashed in the accent colour, so it never reads as the playhead', () => {
    setup({ onHover: vi.fn() })
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 105, clientY: 40 })
    expect(screen.getByTestId('cue-wave-cursor')).toHaveStyle({
      borderLeftStyle: 'dashed',
      borderLeftColor: 'var(--color-accent)',
    })
  })

  it('opens the menu on a right-click with the beat under it', () => {
    const h = setup()
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 30 })
    expect(h.onMenu).toHaveBeenCalledWith({ ms: 10000, x: 100, y: 30 })
  })

  it('quantizes a drag, the hover line and the menu to the bar start when quantizing to the bar', () => {
    const h = setup({ quantize: 'bar', onHover: vi.fn() })
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 105, clientY: 40 })
    expect(screen.getByTestId('cue-wave-cursor').style.left).toBe('12.5%')
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: 105, clientY: 30 })
    expect(h.onMenu).toHaveBeenCalledWith({ ms: 10000, x: 105, y: 30 })
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-A'), { clientX: 160 })
    fireEvent.mouseMove(window, { clientX: 243 })
    expect(screen.getByTestId('cue-wave-drag-ghost').style.left).toBe('30%')
    fireEvent.mouseUp(window, { clientX: 243 })
    expect(h.onMove).toHaveBeenCalledWith('a', 24000)
  })

  it('draws proposals dashed and accepts one with a click', () => {
    const h = setup({ proposals: [32000] })
    fireEvent.click(screen.getByTestId('cue-wave-proposal-32000'))
    expect(h.onAcceptProposal).toHaveBeenCalledWith(32000)
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

  it('shows where the drop will land while hovering, as a bare line with no label over the wave', () => {
    setup({ onHover: vi.fn() })
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(screen.getByTestId('cue-wave-cursor').style.left).toBe('12.5%')
    expect(screen.getByTestId('cue-wave-cursor').textContent).toBe('')
  })

  it('says the track is not analysed and takes no clicks when it has no grid', () => {
    const onOpen = vi.fn<(ms: number) => void>()
    setup({ grid: [], onOpen })
    expect(screen.getByTestId('cue-wave-not-analysed')).toBeInTheDocument()
    expect(screen.queryByTestId('cue-wave')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-wave-not-analysed'), { clientX: 100, clientY: 40 })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('clears the ghost after a click', () => {
    setup({ onHover: vi.fn(), onOpen: vi.fn() })
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(screen.queryByTestId('cue-wave-cursor')).not.toBeInTheDocument()
  })

  it('clears the ghost when it becomes read-only and does not bring it back on editing again', () => {
    const props = {
      wave: null,
      grid: GRID,
      durationMs: 80000,
      cues: [],
      onHover: vi.fn<(ms: number | null) => void>(),
    }
    const { rerender } = render(<CueWave {...props} />)
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(screen.getByTestId('cue-wave-cursor')).toBeInTheDocument()
    rerender(<CueWave {...props} readOnly />)
    expect(screen.queryByTestId('cue-wave-cursor')).not.toBeInTheDocument()
    rerender(<CueWave {...props} />)
    expect(screen.queryByTestId('cue-wave-cursor')).not.toBeInTheDocument()
  })

  it('moves the playhead instead of marking a drop when the full editor seeks with it', () => {
    const onSeek = vi.fn<(ms: number) => void>()
    setup({ onSeek, playheadMs: 20000 })
    expect(screen.getByTestId('cue-wave-playhead').style.left).toBe('25%')
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 400 })
    expect(onSeek).toHaveBeenCalledWith(40000)
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 200 })
    expect(screen.queryByTestId('cue-wave-cursor')).toBeNull()
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

  it('draws no playhead in the folded section', () => {
    setup({ onOpen: vi.fn() })
    expect(screen.queryByTestId('cue-wave-playhead')).toBeNull()
  })

  it('opens the editor on the beat under a folded click, even while it draws the flow under the cursor, so the DJ lands on the grid and places where the bars are visible', () => {
    const onOpen = vi.fn<(ms: number) => void>()
    const onHover = vi.fn<(ms: number | null) => void>()
    setup({ onOpen, onHover })
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 102, clientY: 40 })
    expect(onHover).toHaveBeenLastCalledWith(10000)
    expect(screen.getByTestId('cue-wave-cursor')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 403 })
    expect(onOpen).toHaveBeenCalledWith(40500)
    expect(onHover).toHaveBeenLastCalledWith(null)
    expect(screen.queryByTestId('cue-wave-cursor')).toBeNull()
  })

  it('moves the playhead with a click or a drag in the full editor while it draws the flow under the cursor, so the strip always navigates', () => {
    const onSeek = vi.fn<(ms: number) => void>()
    const onHover = vi.fn<(ms: number | null) => void>()
    setup({ onSeek, onHover, playheadMs: 0 })
    const strip = screen.getByTestId('cue-wave')
    fireEvent.mouseMove(strip, { clientX: 102, clientY: 40 })
    expect(onHover).toHaveBeenLastCalledWith(10000)
    expect(screen.getByTestId('cue-wave-cursor')).toBeInTheDocument()
    fireEvent.mouseDown(strip, { button: 0, clientX: 403 })
    expect(onSeek).toHaveBeenLastCalledWith(40500)
    expect(onHover).toHaveBeenLastCalledWith(null)
    expect(screen.queryByTestId('cue-wave-cursor')).toBeNull()
    fireEvent.mouseUp(window, { clientX: 403 })
    fireEvent.click(strip, { clientX: 403 })
    expect(onSeek).toHaveBeenLastCalledWith(40500)
  })

  it('opens the editor at the point under the cursor with Enter on the strip, as a click would, but not from a focused mark', () => {
    const onOpen = vi.fn<(ms: number) => void>()
    setup({ onOpen, onHover: vi.fn() })
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 102, clientY: 40 })
    fireEvent.keyDown(screen.getByTestId('cue-wave-hot-A'), { key: 'Enter' })
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByTestId('cue-wave'), { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith(10000)
  })

  it('opens the editor at the clicked point when the folded strip only opens', () => {
    const onOpen = vi.fn<(ms: number) => void>()
    setup({ onOpen })
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 200 })
    expect(screen.queryByTestId('cue-wave-cursor')).toBeNull()
    expect(screen.getByTestId('cue-wave').className).toContain('cursor-pointer')
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 400 })
    expect(onOpen).toHaveBeenCalledWith(40000)
  })

  it('hands the beat under the cursor to the editor and forgets it when the cursor leaves, so the flow is drawn only while hovering', () => {
    const onHover = vi.fn<(ms: number | null) => void>()
    setup({ onHover })
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 102, clientY: 40 })
    expect(onHover).toHaveBeenLastCalledWith(10000)
    expect(screen.getByTestId('cue-wave-cursor').style.left).toBe('12.5%')
    fireEvent.mouseLeave(screen.getByTestId('cue-wave'))
    expect(onHover).toHaveBeenLastCalledWith(null)
    expect(screen.queryByTestId('cue-wave-cursor')).toBeNull()
  })

  it('takes the line under the cursor away once the editor stops placing, so Manual never shows where a flow would go', () => {
    const props = {
      wave: null,
      grid: GRID,
      durationMs: 80000,
      cues: [],
      onHover: vi.fn<(ms: number | null) => void>(),
    }
    const { rerender } = render(<CueWave {...props} />)
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(screen.getByTestId('cue-wave-cursor')).toBeInTheDocument()
    rerender(<CueWave {...props} onHover={undefined} />)
    expect(screen.queryByTestId('cue-wave-cursor')).toBeNull()
  })

  it('forgets the beat under the cursor once a press turns into moving the playhead, so no flow hangs over the scrub', () => {
    const onHover = vi.fn<(ms: number | null) => void>()
    const onSeek = vi.fn<(ms: number) => void>()
    setup({ onHover, onSeek, playheadMs: 0 })
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 102, clientY: 40 })
    expect(onHover).toHaveBeenLastCalledWith(10000)
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 102 })
    fireEvent.mouseMove(window, { clientX: 300 })
    expect(onSeek).toHaveBeenLastCalledWith(30000)
    expect(onHover).toHaveBeenLastCalledWith(null)
    expect(screen.queryByTestId('cue-wave-cursor')).toBeNull()
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
    expect(screen.getByTestId('cue-wave-ghost-hot-B')).toHaveStyle({ opacity: '0.42' })
    expect(screen.getByTestId('cue-wave-ghost-hot-B').tagName).toBe('SPAN')
    expect(screen.getByTestId('cue-wave-ghost-call-32000')).toHaveStyle({ opacity: '0.42' })
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-gone', 'true')
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveStyle({ opacity: '0.3' })
    expect(screen.getByTestId('cue-wave-call-40000')).toHaveAttribute('data-gone', 'false')
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

  it('moves a mark instead of the playhead when the drag starts on it', () => {
    const onSeek = vi.fn<(ms: number) => void>()
    const h = setup({ onSeek, playheadMs: 0 })
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-A'), { button: 0, clientX: 160 })
    fireEvent.mouseMove(window, { clientX: 243 })
    fireEvent.mouseUp(window, { clientX: 243 })
    expect(onSeek).not.toHaveBeenCalled()
    expect(h.onMove).toHaveBeenCalledWith('a', 24500)
  })
  it('opens the mark menu on a right-click on a hot cue or a CALL, without the strip menu and without a drag', () => {
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
    expect(h.onMove).not.toHaveBeenCalled()
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
