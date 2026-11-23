// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { CueOffGridBar, type OffGridCue } from './CueOffGridBar'

beforeEach(async () => {
  await i18n.changeLanguage('es')
})

const CALL = { kind: 0, ms: 27793, driftMs: -14 }
const B = { kind: 2, ms: 153617, driftMs: -12 }
const B_CALL = { kind: 0, ms: 153617, driftMs: -12 }
const LATE = { kind: 1, ms: 300000, driftMs: 15 }

function setup(off: OffGridCue[] = [CALL], onShiftGrid?: (ms: number) => void) {
  const onGo = vi.fn<(ms: number) => void>()
  const onSnap = vi.fn<() => void>()
  render(<CueOffGridBar off={off} onGo={onGo} onSnap={onSnap} onShiftGrid={onShiftGrid} />)
  return { onGo, onSnap }
}

describe('CueOffGridBar', () => {
  it('fits in one line: the cue it is on, which way it is off, and where it is among the rest', () => {
    setup([CALL, LATE])
    const current = screen.getByTestId('cues-offgrid-go-27793')
    expect(current).toHaveTextContent('CALL')
    expect(current).toHaveTextContent('0:27.7')
    expect(current).toHaveTextContent('14 ms antes')
    expect(screen.getByTestId('cues-offgrid-position')).toHaveTextContent('1 de 2')
    expect(screen.queryByTestId('cues-offgrid-go-300000')).toBeNull()
  })

  it('steps to the next and previous cue and takes the playhead there', () => {
    const { onGo } = setup([CALL, LATE])
    fireEvent.click(screen.getByTestId('cues-offgrid-next'))
    expect(onGo).toHaveBeenLastCalledWith(300000)
    expect(screen.getByTestId('cues-offgrid-go-300000')).toHaveTextContent('15 ms después')
    expect(screen.getByTestId('cues-offgrid-position')).toHaveTextContent('2 de 2')
    fireEvent.click(screen.getByTestId('cues-offgrid-next'))
    expect(onGo).toHaveBeenLastCalledWith(27793)
    fireEvent.click(screen.getByTestId('cues-offgrid-prev'))
    expect(onGo).toHaveBeenLastCalledWith(300000)
  })

  it('jumps to the cue it shows when pressed', () => {
    const { onGo } = setup()
    fireEvent.click(screen.getByTestId('cues-offgrid-go-27793'))
    expect(onGo).toHaveBeenCalledWith(27793)
  })

  it('counts a hot cue and its CALL at the same spot as one stop, since they move together', () => {
    setup([B, B_CALL])
    expect(screen.getByTestId('cues-offgrid-go-153617')).toHaveTextContent('B + CALL')
    expect(screen.getByTestId('cues-offgrid-position')).toHaveTextContent('1 de 1')
  })

  it('brings them onto the beat with one button', () => {
    const { onSnap } = setup()
    fireEvent.click(screen.getByTestId('cues-offgrid-snap'))
    expect(onSnap).toHaveBeenCalled()
  })

  it('offers to move the grid instead when every cue is off by the same amount, since then the grid moved, not the cues', () => {
    const onShiftGrid = vi.fn<(ms: number) => void>()
    setup(
      [
        { kind: 1, ms: 200, driftMs: 108 },
        { kind: 0, ms: 200, driftMs: 108 },
        { kind: 0, ms: 25800, driftMs: 105 },
      ],
      onShiftGrid,
    )
    fireEvent.click(screen.getByTestId('cues-offgrid-shift-grid'))
    expect(onShiftGrid).toHaveBeenCalledWith(107)
  })

  it('keeps to moving the cues when they are off by different amounts', () => {
    setup([CALL, LATE], vi.fn())
    expect(screen.queryByTestId('cues-offgrid-shift-grid')).toBeNull()
  })

  // At the window's minimum width the folded editor is narrower than the bar in German,
  // Catalan, French, Italian and Portuguese, and "Auf den Beat" ran past the panel's edge
  // while the cue it names was cut to nothing. Folded, its controls wrap onto a second line;
  // full screen it keeps the one line it always fits in.
  it('wraps its controls in the folded editor rather than running past the edge', () => {
    render(<CueOffGridBar off={[CALL, LATE]} onGo={vi.fn()} onSnap={vi.fn()} spaced />)
    expect(screen.getByTestId('cues-offgrid')).toHaveAttribute('data-wrap', 'true')
  })

  it('keeps to one line in the full editor, which always has the room', () => {
    setup([CALL, LATE])
    expect(screen.getByTestId('cues-offgrid')).not.toHaveAttribute('data-wrap')
  })

  it('shows nothing when every cue sits on its beat', () => {
    setup([])
    expect(screen.queryByTestId('cues-offgrid')).toBeNull()
  })
})
