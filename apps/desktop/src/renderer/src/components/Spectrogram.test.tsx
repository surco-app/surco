// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

// A sound engineer wants to read the exact frequency anywhere on the spectrogram, not just
// estimate between the fixed 5 kHz marks. Hovering draws a crosshair labelled with the
// frequency that row maps to; leaving hides it again.
describe('Spectrogram hover frequency crosshair', () => {
  // jsdom does no layout, so getBoundingClientRect returns zeros and every hover would read
  // as the top edge. Stub a 400px-tall box so a mid-height hover maps to a real frequency.
  function hoverAt(clientY: number): void {
    const { container } = render(<Spectrogram spectrum={base} />)
    const box = container.firstChild as HTMLElement
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      height: 400,
      left: 0,
      right: 0,
      bottom: 400,
      width: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    fireEvent.mouseMove(box, { clientY })
  }

  it('shows no crosshair until the cursor enters', () => {
    render(<Spectrogram spectrum={base} />)
    expect(screen.queryByTestId('spectrum-crosshair')).toBeNull()
  })

  it('reads the cursor row as a frequency on the linear axis', () => {
    // Halfway down a 400px box on a 44.1 kHz file is half of Nyquist ≈ 11.0 kHz.
    hoverAt(200)
    expect(screen.getByTestId('spectrum-crosshair')).toHaveTextContent('11.0 kHz')
  })

  it('hides the crosshair when the cursor leaves', () => {
    hoverAt(200)
    fireEvent.mouseLeave(screen.getByTestId('spectrum-crosshair').parentElement as HTMLElement)
    expect(screen.queryByTestId('spectrum-crosshair')).toBeNull()
  })
})
