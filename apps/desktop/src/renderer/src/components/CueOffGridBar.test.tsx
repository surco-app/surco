// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { CueOffGridBar } from './CueOffGridBar'

beforeEach(async () => {
  await i18n.changeLanguage('es')
})

const CALL = { kind: 0, ms: 27793, driftMs: -14 }
const B = { kind: 2, ms: 153617, driftMs: -12 }
const B_CALL = { kind: 0, ms: 153617, driftMs: -12 }

function setup(off = [CALL]) {
  const onGo = vi.fn<(ms: number) => void>()
  const onSnap = vi.fn<() => void>()
  render(<CueOffGridBar off={off} onGo={onGo} onSnap={onSnap} />)
  return { onGo, onSnap }
}

describe('CueOffGridBar', () => {
  it('says how many cues miss their beat and names each one with its time and which way it is off', () => {
    setup([CALL, { kind: 1, ms: 300000, driftMs: 15 }])
    expect(screen.getByTestId('cues-offgrid')).toHaveTextContent('2 cues no caen en el golpe')
    expect(screen.getByTestId('cues-offgrid-go-27793')).toHaveTextContent('CALL')
    expect(screen.getByTestId('cues-offgrid-go-27793')).toHaveTextContent('0:27.7')
    expect(screen.getByTestId('cues-offgrid-go-27793')).toHaveTextContent('14 ms antes')
    expect(screen.getByTestId('cues-offgrid-go-300000')).toHaveTextContent('A')
    expect(screen.getByTestId('cues-offgrid-go-300000')).toHaveTextContent('15 ms después')
  })

  it('shows a hot cue and its CALL at the same spot as one chip, since they move together', () => {
    setup([B, B_CALL])
    expect(screen.getAllByTestId(/^cues-offgrid-go-/)).toHaveLength(1)
    expect(screen.getByTestId('cues-offgrid-go-153617')).toHaveTextContent('B + CALL')
    expect(screen.getByTestId('cues-offgrid')).toHaveTextContent('2 cues no caen en el golpe')
  })

  it('jumps to the cue when its chip is pressed', () => {
    const { onGo } = setup()
    fireEvent.click(screen.getByTestId('cues-offgrid-go-27793'))
    expect(onGo).toHaveBeenCalledWith(27793)
  })

  it('brings them onto the beat with one button', () => {
    const { onSnap } = setup()
    fireEvent.click(screen.getByTestId('cues-offgrid-snap'))
    expect(onSnap).toHaveBeenCalled()
  })

  it('shows nothing when every cue sits on its beat', () => {
    setup([])
    expect(screen.queryByTestId('cues-offgrid')).toBeNull()
  })
})
