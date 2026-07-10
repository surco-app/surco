// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizeConfig, TrackMetadata } from '../../../shared/types'
import '../i18n'
import type { TrackItem } from '../types'
import { NormalizeSection } from './NormalizeSection'

const cfg: NormalizeConfig = { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

function track(over: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 'a',
    inputPath: '/music/a.wav',
    fileName: 'a.wav',
    listLabel: 'a.wav',
    query: '',
    status: 'idle',
    meta: { title: '' } as TrackMetadata,
    ...over,
  }
}

function renderSection(item: TrackItem, isMulti = false): void {
  ;(window as unknown as { api: unknown }).api = {
    waveform: vi.fn().mockResolvedValue({ peaks: [0.5, 1], durationSec: 10 }),
    loudness: vi.fn().mockResolvedValue(null),
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <NormalizeSection
        value={cfg}
        open
        onToggle={vi.fn()}
        onChange={vi.fn()}
        item={item}
        isMulti={isMulti}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// The before/after pair lives with the normalization controls whose effect it
// proves. It can only exist once there IS an after: never before a conversion,
// never for an in-place export (the rewritten source leaves no honest "before"),
// and never in multi-select, where `item` is just the anchor of the selection.
describe('NormalizeSection before/after waveforms', () => {
  it('shows the pair once the track has a converted output', async () => {
    renderSection(track({ outputPath: '/out/a.aiff', status: 'done' }))
    expect(await screen.findByTestId('waveform-compare')).toBeInTheDocument()
  })

  it('shows no pair before the track converts', async () => {
    renderSection(track())
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('waveform-compare')).not.toBeInTheDocument()
  })

  it('shows no pair for an in-place export that rewrote the source', async () => {
    renderSection(track({ outputPath: '/music/a.wav', status: 'done' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('waveform-compare')).not.toBeInTheDocument()
  })

  it('shows no pair in multi-select', async () => {
    renderSection(track({ outputPath: '/out/a.aiff', status: 'done' }), true)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('waveform-compare')).not.toBeInTheDocument()
  })
})
