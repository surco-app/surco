// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LoudnessResult, NormalizeConfig } from '../../../shared/types'
import '../i18n'
import { LoudnessReadout } from './LoudnessReadout'

afterEach(cleanup)

const loud: LoudnessResult = {
  integratedLufs: -16.3,
  truePeakDb: -3.3,
  lra: 6.8,
  channelBalanceDb: 0.3,
  dcOffset: 0.001,
  crestDb: 17.3,
  noiseFloorDb: -60,
}

const club: NormalizeConfig = { mode: 'loudness', targetLufs: -13, truePeakDb: -1, peakDb: -1 }
const off: NormalizeConfig = { ...club, mode: 'none' }

// The estimates used to sit in italics with a footnote legend at the very bottom
// explaining what the italics meant. The arrow carries that meaning inline: it only
// appears on the figures the conversion moves, and the figures it cannot move say "="
// instead of a shifted number the converted file would contradict.
describe('LoudnessReadout estimates', () => {
  it('draws an arrow only on the figures the conversion moves', () => {
    render(<LoudnessReadout loudness={loud} normalize={club} onShowHelp={vi.fn()} />)
    const lufs = screen.getByTestId('loudness-estimate-lufs').textContent ?? ''
    expect(lufs).toContain('→')
    expect(lufs).toContain('-13.0')
    cleanup()
    render(
      <LoudnessReadout
        loudness={loud}
        normalize={{ ...club, targetLufs: -14.3 }}
        onShowHelp={vi.fn()}
      />,
    )
    expect(screen.getByTestId('loudness-estimate-range').textContent).toBe('=')
  })

  it('labels the two columns in the subhead instead of a footnote legend', () => {
    render(<LoudnessReadout loudness={loud} normalize={club} onShowHelp={vi.fn()} />)
    expect(screen.getByTestId('loudness-after-header').textContent).toContain('after converting')
    expect(screen.queryByTestId('loudness-estimate-legend')).not.toBeInTheDocument()
  })

  it('shows neither arrows nor the column label with normalization off', () => {
    render(<LoudnessReadout loudness={loud} normalize={off} onShowHelp={vi.fn()} />)
    expect(screen.queryByTestId('loudness-after-header')).not.toBeInTheDocument()
    expect(screen.queryByTestId('loudness-estimate-lufs')).not.toBeInTheDocument()
  })
})

// The DC offset is a constant added to every sample, so the gain scales it like any other
// level: "=" was false the moment the conversion applied gain. And a limiter holds the
// peaks back while the body takes the full gain, so the peak-to-RMS distance shrinks.
describe('LoudnessReadout estimates that ride the gain', () => {
  const linear: NormalizeConfig = { ...club, targetLufs: -14.3 }

  it('scales the DC offset with the applied gain', () => {
    render(
      <LoudnessReadout
        loudness={{ ...loud, dcOffset: 0.02 }}
        normalize={linear}
        onShowHelp={vi.fn()}
      />,
    )
    expect(screen.getByTestId('loudness-estimate-dc').textContent).toBe('→ 2.5%')
  })

  it('offers no DC estimate once the limiter makes the gain uneven', () => {
    render(
      <LoudnessReadout
        loudness={{ ...loud, dcOffset: 0.02 }}
        normalize={club}
        onShowHelp={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('loudness-estimate-dc')).not.toBeInTheDocument()
  })

  it('offers no DC estimate when each channel takes its own gain', () => {
    render(
      <LoudnessReadout
        loudness={{ ...loud, dcOffset: 0.02 }}
        normalize={{ ...club, mode: 'peak', peakDb: -1, peakPerChannel: true }}
        onShowHelp={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('loudness-estimate-dc')).not.toBeInTheDocument()
  })

  it('still lands the DC offset on zero when centring is ticked', () => {
    render(
      <LoudnessReadout
        loudness={{ ...loud, dcOffset: 0.02 }}
        normalize={{ ...club, removeDcOffset: true }}
        onShowHelp={vi.fn()}
      />,
    )
    expect(screen.getByTestId('loudness-estimate-dc').textContent).toBe('→ 0.0%')
  })

  it('keeps dynamics unchanged under a constant gain, and drops the claim under the limiter', () => {
    render(<LoudnessReadout loudness={loud} normalize={linear} onShowHelp={vi.fn()} />)
    expect(screen.getByTestId('loudness-estimate-crest').textContent).toBe('=')
    cleanup()
    render(<LoudnessReadout loudness={loud} normalize={club} onShowHelp={vi.fn()} />)
    expect(screen.queryByTestId('loudness-estimate-crest')).not.toBeInTheDocument()
  })

  // The limiter pulls the loud passages down while the quiet ones take the full gain: the
  // range shrinks, and a balance that differs between loud and quiet passages is weighted
  // differently, so "=" there was a claim the converted file could contradict.
  it('drops the range and balance claims under the limiter', () => {
    render(<LoudnessReadout loudness={loud} normalize={club} onShowHelp={vi.fn()} />)
    expect(screen.queryByTestId('loudness-estimate-range')).not.toBeInTheDocument()
    expect(screen.queryByTestId('loudness-estimate-balance')).not.toBeInTheDocument()
  })
})

// The verdict was colour alone (the dot and the figure) and its explanation sits in a
// hover tooltip no keyboard or screen reader reaches: a colour-blind user saw three
// identical dots, and assistive tech read a bare number with no judgement. Each cell now
// names its grade in text and draws each grade in its own shape.
describe('LoudnessReadout verdict without colour', () => {
  const mixed: LoudnessResult = { ...loud, integratedLufs: -12, truePeakDb: -0.5, lra: 2 }

  it('names the grade of every cell in text', () => {
    render(<LoudnessReadout loudness={mixed} normalize={off} onShowHelp={vi.fn()} />)
    expect(within(screen.getByTestId('loudness-pill-lufs')).getByText('Good')).toBeInTheDocument()
    expect(within(screen.getByTestId('loudness-pill-peak')).getByText('So-so')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('loudness-pill-range')).getByText('Out of range'),
    ).toBeInTheDocument()
  })

  it('draws each grade in a different shape', () => {
    render(<LoudnessReadout loudness={mixed} normalize={off} onShowHelp={vi.fn()} />)
    const shapes = ['lufs', 'peak', 'range'].map((id) =>
      screen.getByTestId(`loudness-grade-mark-${id}`).getAttribute('data-shape'),
    )
    expect(shapes.every(Boolean)).toBe(true)
    expect(new Set(shapes).size).toBe(3)
  })
})
