// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SpectrumResult } from '../../../shared/types'
import '../i18n'
import { Spectrogram } from './Spectrogram'

afterEach(cleanup)

const base: SpectrumResult = {
  image: 'data:image/png;base64,',
  cutoffHz: 17000,
  sampleRateHz: 44100,
  processed: false,
}

describe('Spectrogram cutoff label', () => {
  // A knee-free taper is a genuine, gently rolled-off master — the line marks how far the
  // real highs reach, not a codec wall. Calling it a "cutoff" there contradicts the "no
  // codec cut" caption and is exactly what made a healthy track read as suspect.
  it('labels a knee-free taper as how far the highs reach, not a cutoff', () => {
    render(<Spectrogram spectrum={{ ...base, hasKnee: false }} />)
    expect(screen.getByText(/highs to ~17\.0 kHz/)).toBeInTheDocument()
    expect(screen.queryByText(/cutoff/)).toBeNull()
  })

  it('labels a detected knee as a cutoff', () => {
    render(<Spectrogram spectrum={{ ...base, hasKnee: true }} />)
    expect(screen.getByText(/cutoff ~17\.0 kHz/)).toBeInTheDocument()
  })

  // Regenerated highs still sit over a real ceiling, so the line is a cutoff there even
  // though no plain knee was found.
  it('labels regenerated highs as a cutoff despite no knee', () => {
    render(<Spectrogram spectrum={{ ...base, hasKnee: false, processed: true }} />)
    expect(screen.getByText(/cutoff ~17\.0 kHz/)).toBeInTheDocument()
  })
})
