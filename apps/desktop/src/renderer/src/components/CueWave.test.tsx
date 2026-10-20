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
    onMarkDrop: vi.fn(),
    onUnmarkDrop: vi.fn(),
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

  it('puts the marks on the strip’s top edge over the wave, as the list row does, with the wave filling the rest', () => {
    setup()
    expect(screen.getByTestId('cue-wave-hot-A').style.top).toBe('0px')
    expect(screen.getByTestId('cue-wave-call-16000').style.top).toBe('0px')
    expect(screen.getByTestId('cue-wave-area').style.top).toBe('0px')
    expect(screen.getByTestId('cue-wave-area').style.bottom).toBe('0px')
    expect(screen.getByTestId('cue-wave-bars').style.height).toBe('90%')
  })

  it('marks only every 16 bars with a small tick at the bottom, so the strip reads as a navigator and not a grid', () => {
    setup()
    expect(screen.queryAllByTestId('cue-wave-bar')).toHaveLength(0)
    expect(screen.getAllByTestId('cue-wave-tick').map((t) => t.style.left)).toEqual([
      '0%',
      '40%',
      '80%',
    ])
  })

  it('marks a drop on the beat under a click on the empty wave and clears the selection', () => {
    const h = setup()
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 60 })
    expect(h.onMarkDrop).toHaveBeenCalledWith(10000)
    expect(h.onSelect).toHaveBeenCalledWith(null)
  })

  it('takes a drop away with a click on its line', () => {
    const h = setup()
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 402, clientY: 60 })
    expect(h.onUnmarkDrop).toHaveBeenCalledWith('d')
  })

  it('selects a cue with a click on its square without marking a drop there', () => {
    const h = setup()
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-A'), { clientX: 160 })
    fireEvent.mouseUp(window, { clientX: 160 })
    fireEvent.click(screen.getByTestId('cue-wave-hot-A'), { clientX: 160 })
    expect(h.onSelect).toHaveBeenCalledWith('a')
    expect(h.onMarkDrop).not.toHaveBeenCalled()
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

  it('selects a focused mark with Enter without marking a drop under the ghost', () => {
    const h = setup()
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(screen.getByTestId('cue-wave-ghost')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-wave-hot-A'))
    fireEvent.keyDown(screen.getByTestId('cue-wave-hot-A'), { key: 'Enter' })
    expect(h.onSelect).toHaveBeenCalledWith('a')
    expect(h.onMarkDrop).not.toHaveBeenCalled()
  })

  it('swallows the click that follows a drag so the release does not mark a drop', () => {
    vi.useFakeTimers()
    const h = setup()
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-A'), { clientX: 160 })
    fireEvent.mouseMove(window, { clientX: 243 })
    fireEvent.mouseUp(window, { clientX: 243 })
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 243 })
    expect(h.onMarkDrop).not.toHaveBeenCalled()
    vi.runAllTimers()
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 100 })
    expect(h.onMarkDrop).toHaveBeenCalledWith(10000)
    vi.useRealTimers()
  })

  it('keeps a proposal clickable under a mark at the same place', () => {
    setup({ proposals: [16000] })
    const all = screen.getAllByTestId(/^cue-wave-(proposal|hot)-/)
    expect(all.map((e) => e.dataset.testid)).toEqual(['cue-wave-proposal-16000', 'cue-wave-hot-A'])
  })

  it('opens the menu on a right-click with the beat under it', () => {
    const h = setup()
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 30 })
    expect(h.onMenu).toHaveBeenCalledWith({ ms: 10000, x: 100, y: 30 })
  })

  it('draws proposals dashed and accepts one with a click', () => {
    const h = setup({ proposals: [32000] })
    fireEvent.click(screen.getByTestId('cue-wave-proposal-32000'))
    expect(h.onAcceptProposal).toHaveBeenCalledWith(32000)
    expect(h.onMarkDrop).not.toHaveBeenCalled()
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
    setup()
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(screen.getByTestId('cue-wave-ghost').style.left).toBe('12.5%')
    expect(screen.getByTestId('cue-wave-ghost').textContent).toBe('')
  })

  it('says the track is not analysed and takes no clicks when it has no grid', () => {
    const h = setup({ grid: [] })
    expect(screen.getByTestId('cue-wave-not-analysed')).toBeInTheDocument()
    expect(screen.queryByTestId('cue-wave')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-wave-not-analysed'), { clientX: 100, clientY: 40 })
    expect(h.onMarkDrop).not.toHaveBeenCalled()
  })

  it.each([800, 1600])(
    'removes a drop 5 px away and adds beside it 8 px away at %i px wide',
    (width) => {
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
      const centre = width / 2
      const h = setup()
      fireEvent.click(screen.getByTestId('cue-wave'), { clientX: centre + 5, clientY: 40 })
      expect(h.onUnmarkDrop).toHaveBeenCalledWith('d')
      expect(h.onMarkDrop).not.toHaveBeenCalled()
      fireEvent.click(screen.getByTestId('cue-wave'), { clientX: centre + 8, clientY: 40 })
      expect(h.onMarkDrop).toHaveBeenCalledTimes(1)
      expect(h.onMarkDrop.mock.calls[0][0]).not.toBe(40000)
    },
  )

  it('shows no ghost over an existing drop', () => {
    setup()
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 400, clientY: 40 })
    expect(screen.queryByTestId('cue-wave-ghost')).not.toBeInTheDocument()
  })

  it('clears the ghost after a click', () => {
    setup()
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(screen.queryByTestId('cue-wave-ghost')).not.toBeInTheDocument()
  })

  it('clears the ghost when it becomes read-only and does not bring it back on editing again', () => {
    const props = { wave: null, grid: GRID, durationMs: 80000, cues: [] }
    const { rerender } = render(<CueWave {...props} />)
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(screen.getByTestId('cue-wave-ghost')).toBeInTheDocument()
    rerender(<CueWave {...props} readOnly />)
    expect(screen.queryByTestId('cue-wave-ghost')).not.toBeInTheDocument()
    rerender(<CueWave {...props} />)
    expect(screen.queryByTestId('cue-wave-ghost')).not.toBeInTheDocument()
  })

  it('moves the playhead instead of marking a drop when the full editor seeks with it', () => {
    const onSeek = vi.fn<(ms: number) => void>()
    const handlers = setup({ onSeek, playheadMs: 20000 })
    expect(screen.getByTestId('cue-wave-playhead').style.left).toBe('25%')
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 400 })
    expect(onSeek).toHaveBeenCalledWith(40000)
    expect(handlers.onMarkDrop).not.toHaveBeenCalled()
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 200 })
    expect(screen.queryByTestId('cue-wave-ghost')).toBeNull()
  })

  it('draws no playhead and keeps marking drops in the folded section', () => {
    const handlers = setup()
    expect(screen.queryByTestId('cue-wave-playhead')).toBeNull()
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 200 })
    expect(handlers.onMarkDrop).toHaveBeenCalled()
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
})
