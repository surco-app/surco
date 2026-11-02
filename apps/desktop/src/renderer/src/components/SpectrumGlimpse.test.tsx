// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpectrumResult } from '../../../shared/types'
import '../i18n'
import { createQueryClient } from '../lib/queryClient'
import { installApi } from '../test/api'
import { SpectrumGlimpse } from './SpectrumGlimpse'

afterEach(cleanup)

const HERE = '/downloads/strobe.flac'
const LIBRARY = '/music/strobe.m4a'

const full: SpectrumResult = {
  image: 'data:image/png;base64,here',
  cutoffHz: 22050,
  sampleRateHz: 44100,
  processed: false,
  hasKnee: false,
}
const lossy: SpectrumResult = {
  image: 'data:image/png;base64,library',
  cutoffHz: 16000,
  sampleRateHz: 44100,
  processed: false,
  hasKnee: true,
}

function renderGlimpse(
  spectra: Record<string, SpectrumResult | Promise<SpectrumResult>>,
  loser: 'here' | 'library' = 'library',
): ReturnType<typeof installApi> {
  const api = installApi({ spectrogram: vi.fn(async (path: string) => spectra[path]) })
  const ui: React.ReactElement = (
    <SpectrumGlimpse
      herePath={HERE}
      libraryPath={LIBRARY}
      hereLabel="This file · FLAC"
      libraryLabel="Apple Music · M4A"
      loser={loser}
    />
  )
  render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>)
  return api
}

const strip = (side: 'here' | 'library') => screen.getByTestId(`spectrum-glimpse-${side}`)
const pct = (el: HTMLElement, prop: 'top' | 'height') => Number.parseFloat(el.style[prop])

describe('SpectrumGlimpse', () => {
  // "Cut at 16 kHz" is a claim the user has to take on trust; the two pictures side by side
  // show it, each copy under its own name so the reader knows which is which.
  it('shows both copies, each with its own picture and name', async () => {
    renderGlimpse({ [HERE]: full, [LIBRARY]: lossy })
    expect(await screen.findByTestId('spectrum-glimpse')).toBeInTheDocument()
    expect(strip('here')).toHaveTextContent('This file · FLAC')
    expect(strip('library')).toHaveTextContent('Apple Music · M4A')
    expect(strip('here').querySelector('img')).toHaveAttribute('src', full.image)
    expect(strip('library').querySelector('img')).toHaveAttribute('src', lossy.image)
  })

  // The two cutoffs are only comparable if the same frequency sits at the same height in
  // both: a 48 kHz copy drawn to its own Nyquist would put 16 kHz higher than in a 44.1 one.
  it('draws both copies on one frequency scale', async () => {
    renderGlimpse({ [HERE]: { ...full, sampleRateHz: 48000, cutoffHz: 24000 }, [LIBRARY]: lossy })
    await screen.findByTestId('spectrum-glimpse')
    const hereImage = strip('here').querySelector<HTMLElement>(
      '[data-testid="spectrum-glimpse-image"]',
    )
    const libraryImage = strip('library').querySelector<HTMLElement>(
      '[data-testid="spectrum-glimpse-image"]',
    )
    expect(pct(hereImage as HTMLElement, 'height')).toBeCloseTo(100)
    expect(pct(libraryImage as HTMLElement, 'height')).toBeCloseTo((22050 / 24000) * 100)
    const libraryCut = strip('library').querySelector<HTMLElement>(
      '[data-testid="spectrum-glimpse-cutoff"]',
    )
    expect(pct(libraryCut as HTMLElement, 'top')).toBeCloseTo((1 - 16000 / 24000) * 100)
  })

  // The band the worse copy is missing is the verdict itself, so only that copy wears it.
  it('marks the missing band on the worse copy only', async () => {
    renderGlimpse({ [HERE]: full, [LIBRARY]: lossy })
    await screen.findByTestId('spectrum-glimpse')
    expect(strip('library').querySelector('[data-testid="spectrum-glimpse-lost"]')).not.toBeNull()
    expect(strip('here').querySelector('[data-testid="spectrum-glimpse-lost"]')).toBeNull()
    expect(strip('library')).toHaveTextContent('cutoff ~16')
  })

  it('marks this file when it is the worse copy', async () => {
    renderGlimpse({ [HERE]: lossy, [LIBRARY]: full }, 'here')
    await screen.findByTestId('spectrum-glimpse')
    expect(strip('here').querySelector('[data-testid="spectrum-glimpse-lost"]')).not.toBeNull()
    expect(strip('library').querySelector('[data-testid="spectrum-glimpse-lost"]')).toBeNull()
  })

  // Reading one frequency across both copies is the comparison: the line follows the
  // cursor in the strip under it and in the other one at the same frequency.
  it('reads the frequency under the cursor in both copies at once', async () => {
    renderGlimpse({ [HERE]: full, [LIBRARY]: lossy })
    await screen.findByTestId('spectrum-glimpse')
    const target = strip('library')
    target.getBoundingClientRect = () =>
      ({ top: 0, height: 100, left: 0, width: 200, bottom: 100, right: 200 }) as DOMRect
    fireEvent.mouseMove(target, { clientY: 25 })
    const lines = screen.getAllByTestId('spectrum-glimpse-crosshair')
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(pct(line, 'top')).toBeCloseTo(25)
      expect(line).toHaveTextContent('16.5 kHz')
    }
    fireEvent.mouseLeave(target)
    expect(screen.queryByTestId('spectrum-glimpse-crosshair')).toBeNull()
  })

  it('holds the space while either copy is still being analysed', async () => {
    renderGlimpse({ [HERE]: full, [LIBRARY]: new Promise(() => {}) })
    expect(await screen.findByTestId('spectrum-glimpse-placeholder')).toBeInTheDocument()
    expect(screen.queryByTestId('spectrum-glimpse')).toBeNull()
  })
})
