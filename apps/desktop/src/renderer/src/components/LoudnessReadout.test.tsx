// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
