// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpectrumResult } from '../../../shared/types'
import '../i18n'
import { resetEditorSections, useMaximizedSection } from '../hooks/useEditorSections'
import { Spectrogram } from './Spectrogram'

afterEach(() => {
  cleanup()
  resetEditorSections()
})

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

// A fake lossless is the most damning verdict: the whole band above the codec cut is dead,
// synthetic silence dressed up as lossless. Shading that dead band red — only when the file
// is actually a transcode — makes "the audio ends here" legible without reading a spectrogram.
describe('Spectrogram dead-band shading', () => {
  it('shades the band above the cutoff when the file is a transcode', () => {
    render(<Spectrogram spectrum={{ ...base, hasKnee: true }} transcoded />)
    expect(screen.getByTestId('spectrum-deadband')).toBeInTheDocument()
  })

  it('leaves a genuine track unshaded', () => {
    render(<Spectrogram spectrum={{ ...base, hasKnee: false }} />)
    expect(screen.queryByTestId('spectrum-deadband')).toBeNull()
  })
})

// A sound engineer wants to read the exact frequency anywhere on the spectrogram, not just
// estimate between the fixed 5 kHz marks. Hovering draws a crosshair labelled with the
// frequency that row maps to; leaving hides it again.
// Maximizing the Audio Quality section blows its box up to the whole window. The
// frequency marks (20k/15k/…) position by percent of that box, but the spectrogram image
// used to keep a fixed 320px height — so the picture flattened into a thin band stretched
// across the window while the marks spread over the full height, the "waveform smeared
// across the background" bug. The image must grow WITH its box so the two never desync.
describe('Spectrogram maximized height', () => {
  // A tiny harness that flips the shared maximize store to the quality section, the way a
  // SectionHeader's maximize button does, then renders the spectrogram under it.
  function Maximized(): React.JSX.Element {
    const { setMaximized } = useMaximizedSection()
    useEffect(() => setMaximized('quality'), [setMaximized])
    return <Spectrogram spectrum={base} />
  }

  it('lets the image fill its box while maximized instead of a fixed short strip', () => {
    render(<Maximized />)
    const img = screen.getByTestId('spectrogram')
    expect(img.className).toContain('h-full')
    expect(img.className).not.toContain('h-80')
  })

  it('keeps the compact fixed height when not maximized', () => {
    render(<Spectrogram spectrum={base} />)
    const img = screen.getByTestId('spectrogram')
    expect(img.className).toContain('h-80')
  })
})

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

// The duotone is an SVG filter referenced by id, and the ramp inside it follows the
// theme. Two pictures sharing one id is not a stylistic problem: `url(#id)` resolves to
// the FIRST match in document order, so one instance would recolor through the other's
// filter. They coexist for real during the editor's per-track remount, where the old
// subtree has not unmounted before the new one mounts, and the maximized section renders
// through a portal appended to document.body — i.e. after the inline one.
describe('Spectrogram duotone filter identity', () => {
  it('gives each picture its own filter so one never recolors through another', () => {
    render(
      <div>
        <Spectrogram spectrum={base} />
        <Spectrogram spectrum={base} />
      </div>,
    )
    const ids = [...document.querySelectorAll('filter')].map((f) => f.getAttribute('id'))
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('points each picture at its own filter with a usable url() reference', () => {
    // useId's raw value contains colons, which are not valid in a url(#…) fragment —
    // a filter referenced that way silently fails to apply and the spectrum renders
    // in the raw grayscale ffmpeg emitted.
    render(<Spectrogram spectrum={base} />)
    const id = document.querySelector('filter')?.getAttribute('id') ?? ''
    expect(id).not.toBe('')
    expect(id).toMatch(/^[A-Za-z][\w-]*$/)
    expect(screen.getByTestId('spectrogram')).toHaveStyle({ filter: `url(#${id})` })
  })
})
