// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizeConfig, TrackMetadata } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
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

function renderSection(
  item: TrackItem,
  selectedCount = 1,
  loudness: unknown = null,
  // The estimate only exists with a mode active, so a test that reads it passes one in.
  value: NormalizeConfig = cfg,
): void {
  ;(window as unknown as { api: unknown }).api = {
    waveform: vi.fn().mockResolvedValue({ peaks: [0.5, 1], rms: [0.2, 0.4], durationSec: 10 }),
    loudness: vi.fn().mockResolvedValue(loudness),
  }
  const client = createQueryClient()
  render(
    <QueryClientProvider client={client}>
      <NormalizeSection
        value={value}
        open
        onToggle={vi.fn()}
        onChange={vi.fn()}
        item={item}
        selectedCount={selectedCount}
        onShowHelp={vi.fn()}
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
    renderSection(track({ outputPath: '/out/a.aiff', status: 'done' }), 3)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('waveform-compare')).not.toBeInTheDocument()
  })

  // Before a conversion exists the section still shows the source's own waveform, so
  // the controls aren't tuned blind: the wave (and its clipping peaks) is what the
  // normalization decision is about.
  it('shows the source waveform alone before the track converts', async () => {
    renderSection(track())
    expect(await screen.findByTestId('waveform-solo')).toBeInTheDocument()
  })

  it('replaces the solo waveform with the pair once converted', async () => {
    renderSection(track({ outputPath: '/out/a.aiff', status: 'done' }))
    expect(await screen.findByTestId('waveform-compare')).toBeInTheDocument()
    expect(screen.queryByTestId('waveform-solo')).not.toBeInTheDocument()
  })

  it('shows no solo waveform in multi-select', async () => {
    renderSection(track(), 3)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('waveform-solo')).not.toBeInTheDocument()
  })

  // The pair lands at the bottom of a scrolling editor, below the fold — a user who
  // just converted sees nothing change unless the result scrolls itself into view.
  // Same reveal pattern as NormalizeControls' mode switch.
  it('scrolls the pair into view when it appears after a conversion', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    ;(window as unknown as { api: unknown }).api = {
      waveform: vi.fn().mockResolvedValue(null),
      loudness: vi.fn().mockResolvedValue(null),
    }
    const client = createQueryClient()
    const ui = (item: TrackItem): React.ReactElement => (
      <QueryClientProvider client={client}>
        <NormalizeSection
          value={cfg}
          open
          onToggle={vi.fn()}
          onChange={vi.fn()}
          item={item}
          selectedCount={1}
          onShowHelp={vi.fn()}
        />
      </QueryClientProvider>
    )
    const { rerender } = render(ui(track()))
    expect(scroll).not.toHaveBeenCalled()
    rerender(ui(track({ outputPath: '/out/a.aiff', status: 'done' })))
    expect(scroll).toHaveBeenCalled()
  })

  // Flipping back to an already-converted track remounts the editor with the pair
  // present from the start — auto-scrolling there would yank the view for no event.
  it('does not scroll on mount when the track was already converted', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    renderSection(track({ outputPath: '/out/a.aiff', status: 'done' }))
    expect(scroll).not.toHaveBeenCalled()
  })
})

describe('NormalizeSection layout', () => {
  const loud: NormalizeConfig = { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

  function renderWith(
    over: { open?: boolean; value?: NormalizeConfig } = {},
  ): ReturnType<typeof render> {
    ;(window as unknown as { api: unknown }).api = {
      waveform: vi.fn().mockResolvedValue({ peaks: [0.5, 1], rms: [0.2, 0.4], durationSec: 10 }),
      loudness: vi.fn().mockResolvedValue(null),
    }
    const client = createQueryClient()
    return render(
      <QueryClientProvider client={client}>
        <NormalizeSection
          value={over.value ?? cfg}
          open={over.open ?? true}
          onToggle={vi.fn()}
          onChange={vi.fn()}
          item={track()}
          selectedCount={1}
          onShowHelp={vi.fn()}
        />
      </QueryClientProvider>,
    )
  }

  // Folded and off, the header used to show nothing at all — "off" and "never
  // looked at it" were the same pixels. The dim summary states the off mode, and
  // when a mode is active it carries the figures the badge alone omits: what the
  // conversion will actually target.
  it('summarizes the off state in the header while folded', () => {
    renderWith({ open: false, value: cfg })
    expect(screen.getByTestId('normalize-summary')).toHaveTextContent('None')
  })

  it('summarizes the loudness figures in the header while folded', () => {
    renderWith({ open: false, value: loud })
    expect(screen.getByTestId('normalize-summary')).toHaveTextContent('-14 LUFS · -1 dBTP')
  })

  it('summarizes the peak ceiling in the header while folded', () => {
    renderWith({
      open: false,
      value: { mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: -0.1 },
    })
    expect(screen.getByTestId('normalize-summary')).toHaveTextContent('-0.1 dB')
  })

  it('drops the summary once the section is open', () => {
    renderWith({ open: true, value: loud })
    expect(screen.queryByTestId('normalize-summary')).not.toBeInTheDocument()
  })

  // The badge exists so a FOLDED section still shows that the convert will
  // normalize; open, the segmented control right below says the same thing, and
  // showing both reads as two controls for one fact.
  it('shows the active-mode badge only while folded', () => {
    const first = renderWith({ open: false, value: loud })
    expect(screen.getByTestId('normalize-active-badge')).toBeInTheDocument()
    first.unmount()

    renderWith({ open: true, value: loud })
    expect(screen.queryByTestId('normalize-active-badge')).not.toBeInTheDocument()
  })

  // The cue warning used to sit between the dials and the wave — right where the
  // eye travels from moving the target to seeing the preview. It closes the
  // section as a footnote instead, and exactly once (the controls' inline copy is
  // silenced here so the editor never shows it twice).
  it('shows the cue warning once, below the waveform', async () => {
    renderWith({ value: loud })
    const warning = await screen.findByTestId('normalize-cue-warning')
    expect(screen.getAllByText(/Re-encodes the audio/)).toHaveLength(1)
    const strip = screen.getByTestId('waveform-strip')
    expect(strip.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows no cue warning while normalization is off', async () => {
    renderWith({ value: cfg })
    await screen.findByTestId('waveform-solo')
    expect(screen.queryByTestId('normalize-cue-warning')).not.toBeInTheDocument()
    expect(screen.queryByText(/Re-encodes the audio/)).not.toBeInTheDocument()
  })
})

// The measurement used to ride the header as its own pill. It doesn't any more: it was
// typographically identical to the target summary beside it (same template, same units,
// same tabular-nums), so the header printed one figure twice with nothing saying which was
// which — and it took 164px of a 241px header, truncating the target to "No…". The figure
// is not lost: the estimate below opens with it, and Quality grades it by colour.
describe('NormalizeSection measured figures', () => {
  it('opens the estimate with the source measurement instead of a header pill', async () => {
    renderSection(
      track(),
      1,
      { integratedLufs: -8.6, truePeakDb: 0.2, loudnessRange: 5, samplePeakDb: 0.1 },
      // The estimate only renders with a mode active — mode 'none' has nothing to predict.
      { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
    )
    // The estimate lives in the wave's PREVIEW legend now — ORIGINAL/PREVIEW were
    // already the section's before/after vocabulary, and a separate line above the
    // wave was a second narrator that could even disagree with it (the legend used
    // to print the dials, not the outcome). Target -14 from -8.6 is -5.4 dB of gain,
    // landing the 0.2 dBTP peak at -5.2.
    const preview = await screen.findByTestId('waveform-preview', undefined, {
      timeout: 3000,
    })
    expect(preview).toHaveTextContent('-14.0 LUFS')
    expect(preview).toHaveTextContent('-5.2 dBTP')
    expect(screen.queryByTestId('normalize-measured-pill')).not.toBeInTheDocument()
    expect(screen.queryByTestId('normalize-prediction')).not.toBeInTheDocument()
  })

  it('shows no pill before the measurement exists', async () => {
    renderSection(track())
    await screen.findByTestId('waveform-solo')
    expect(screen.queryByTestId('normalize-measured-pill')).not.toBeInTheDocument()
  })

  // With several rows selected the dials look exactly as they do for one track, but the
  // batch applies whatever they say to EVERY selected track — one shared override, not a
  // per-track value. The section hid its waveform and said nothing else, so a user tuning
  // what looked like this track's loudness was silently setting it for all forty.
  describe('scope of a multi-selection', () => {
    it('says how many tracks the settings will apply to', () => {
      renderSection(track(), 40)
      expect(screen.getByTestId('normalize-scope')).toHaveTextContent('40')
    })

    it('says nothing about scope for a single track', () => {
      renderSection(track(), 1)
      expect(screen.queryByTestId('normalize-scope')).not.toBeInTheDocument()
    })
  })
})
