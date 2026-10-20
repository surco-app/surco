// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { HOT_MARK_PX, WAVE_MARK_LANE_PX } from '../lib/cueMarks'
import { CueWave, type WaveCue } from './CueWave'

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

function drop(ms: number, pending = true): WaveCue {
  return { key: `d${ms}`, ms, kind: 0, color: null, pending }
}

describe('CueWave', () => {
  it('paints the wave in Surco accent like every other wave in the app, not in rekordbox colours', () => {
    setup({
      wave: [
        { h: 1, rgb: [255, 0, 0] },
        { h: 0.5, rgb: null },
      ],
    })
    const fills = [...document.querySelectorAll('rect')].map((r) => r.getAttribute('fill'))
    expect(new Set(fills)).toEqual(new Set(['var(--color-accent)']))
  })

  it('draws hot cues as lettered squares in rekordbox colours and CALLs under them at one height', () => {
    setup()
    const a = screen.getByTestId('cue-wave-hot-A')
    expect(a).toHaveTextContent('A')
    expect(a).toHaveStyle({ backgroundColor: '#e62828' })
    const paired = screen.getByTestId('cue-wave-call-16000')
    const dropCall = screen.getByTestId('cue-wave-call-40000')
    expect(paired.style.left).toBe(a.style.left)
    expect(paired.style.top).toBe('15px')
    expect(dropCall.style.top).toBe('15px')
    expect(screen.getByTestId('cue-wave-drop-40000')).toHaveTextContent('DROP')
    expect(screen.getByTestId('cue-wave-drop-40000')).toHaveAttribute('data-pending', 'true')
    expect(screen.queryByTestId('cue-wave-drop-16000')).toBeNull()
    expect(
      screen.getAllByTestId('cue-wave-bar').filter((b) => b.dataset.strong === 'true'),
    ).toHaveLength(3)
  })

  it('keeps the hot cue and its CALL in a lane above the wave, as rekordbox does, so no mark hides the bars', () => {
    setup()
    const lane = WAVE_MARK_LANE_PX
    expect(
      Number.parseFloat(screen.getByTestId('cue-wave-hot-A').style.top) + HOT_MARK_PX.wave,
    ).toBeLessThan(lane)
    expect(
      Number.parseFloat(screen.getByTestId('cue-wave-call-16000').style.top) + 10,
    ).toBeLessThanOrEqual(lane)
    expect(screen.getByTestId('cue-wave-area').style.top).toBe(`${lane}px`)
  })

  it('draws a half wave growing up from the baseline, as rekordbox does, instead of mirroring it around the middle', () => {
    setup({
      wave: [
        { h: 1, rgb: null },
        { h: 0.5, rgb: null },
        { h: 0, rgb: null },
      ],
    })
    const rects = [...screen.getByTestId('cue-wave-area').querySelectorAll('rect')]
    expect(rects).toHaveLength(3)
    for (const r of rects) {
      expect(Number(r.getAttribute('y')) + Number(r.getAttribute('height'))).toBeCloseTo(100)
    }
    expect(Number(rects[1].getAttribute('height'))).toBeCloseTo(50)
  })

  it('lets the half wave reach the bottom edge and lays the drop labels over it, so no band under the wave goes to waste', () => {
    setup()
    expect(screen.getByTestId('cue-wave-area').style.bottom).toBe('0px')
    const label = screen.getByTestId('cue-wave-drop-label-40000')
    expect(label.style.top).toBe('0px')
    expect(label.style.bottom).toBe('')
  })

  it('caps only the phrase lines of the overview, where a cap on every bar would grey out the whole wave', () => {
    setup()
    const lines = screen.getAllByTestId('cue-wave-bar')
    for (const line of lines) {
      expect(within(line).queryAllByTestId('cue-grid-cap')).toHaveLength(
        line.dataset.strong === 'true' ? 2 : 0,
      )
    }
    expect(lines.some((l) => l.dataset.strong === 'true')).toBe(true)
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

  it('shows where the drop will land while hovering', () => {
    setup()
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(screen.getByTestId('cue-wave-ghost')).toHaveTextContent('+ drop')
  })

  it('names the beat the hover will take, so the user can tell which of the beats under the pointer it is', () => {
    setup()
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(screen.getByTestId('cue-wave-ghost')).toHaveTextContent('0:10.000')
    expect(screen.getByTestId('cue-wave-ghost')).toHaveTextContent('6.1')
  })

  it('names where each drop sits', () => {
    setup()
    expect(screen.getByTestId('cue-wave-drop-40000')).toHaveTextContent('0:40.000')
    expect(screen.getByTestId('cue-wave-drop-40000')).toHaveTextContent('21.1')
  })

  it('turns the label of a drop near the end to the left so the edge does not cut it', () => {
    setup({ cues: [drop(76000)] })
    expect(screen.getByTestId('cue-wave-drop-label-76000')).toHaveAttribute('data-side', 'left')
  })

  it('stacks the labels of two close drops instead of drawing them over each other', () => {
    setup({ cues: [drop(40000, false), drop(42000)] })
    expect(screen.getByTestId('cue-wave-drop-label-40000')).toHaveAttribute('data-row', '0')
    expect(screen.getByTestId('cue-wave-drop-label-42000')).toHaveAttribute('data-row', '1')
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
})
