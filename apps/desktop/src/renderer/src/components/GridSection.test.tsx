// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BeatgridResult } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
import '../i18n'
import { GridSection } from './GridSection'

afterEach(cleanup)

const detected: BeatgridResult = { bpm: 128.04, confidence: 0.9, anchorSec: 0.25 }

let client: QueryClient
beforeEach(() => {
  client = createQueryClient()
  ;(window as unknown as { api: unknown }).api = {
    beatgrid: vi.fn().mockResolvedValue(detected),
  }
})

function section(over: Partial<React.ComponentProps<typeof GridSection>> = {}): React.JSX.Element {
  return (
    <QueryClientProvider client={client}>
      <GridSection
        value={undefined}
        open
        onToggle={() => {}}
        inputPath="/in/track.wav"
        {...over}
      />
    </QueryClientProvider>
  )
}

describe('GridSection header', () => {
  // The detection's finding rides the header as a pill, the app's one convention
  // for analysis results — readable without opening the section.
  it('pills the detected tempo once the analysis lands', async () => {
    render(section())
    const pill = await screen.findByTestId('grid-detected-pill', undefined, { timeout: 3000 })
    expect(pill).toHaveTextContent('Detected 128.0 BPM')
  })

  // A user-confirmed grid outranks the suggestion: the folded header wears it as
  // the accent badge, same semantics as the trim's active cut badge.
  it('wears a staged grid as the folded active badge', () => {
    render(section({ value: { bpm: 127.5, anchorSec: 0.1 }, open: false }))
    expect(screen.getByTestId('grid-active-badge')).toHaveTextContent('127.50 BPM')
    expect(screen.queryByTestId('grid-detected-pill')).not.toBeInTheDocument()
  })

  // Beatless material measures null: the section must say so instead of leaving
  // an empty body that reads as a broken analysis.
  it('says when no steady beat was found', async () => {
    ;(window as unknown as { api: { beatgrid: unknown } }).api.beatgrid = vi
      .fn()
      .mockResolvedValue(null)
    render(section())
    const nothing = await screen.findByTestId('grid-nothing', undefined, { timeout: 3000 })
    expect(nothing).toHaveTextContent('No steady beat detected.')
  })

  // The detection decodes minutes of audio; a folded section must not pay for it.
  it('does not analyse while folded', async () => {
    const probe = vi.fn().mockResolvedValue(detected)
    ;(window as unknown as { api: { beatgrid: unknown } }).api.beatgrid = probe
    render(section({ open: false }))
    await new Promise((r) => setTimeout(r, 1200))
    expect(probe).not.toHaveBeenCalled()
  })
})
