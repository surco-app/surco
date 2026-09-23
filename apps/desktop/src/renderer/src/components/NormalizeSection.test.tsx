// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizeConfig, OutputFormat, TrackMetadata } from '../../../shared/types'
import i18n from '../i18n'
import { createQueryClient } from '../lib/queryClient'
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
  showHints?: boolean,
  onHideHints?: () => void,
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
        format="aiff"
        showHints={showHints}
        onHideHints={onHideHints}
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
          format="aiff"
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
    over: {
      open?: boolean
      value?: NormalizeConfig
      format?: OutputFormat
      onChange?: (config: NormalizeConfig) => void
      loudness?: unknown
      selectedCount?: number
    } = {},
  ): ReturnType<typeof render> {
    ;(window as unknown as { api: unknown }).api = {
      waveform: vi.fn().mockResolvedValue({ peaks: [0.5, 1], rms: [0.2, 0.4], durationSec: 10 }),
      loudness: vi.fn().mockResolvedValue(over.loudness ?? null),
    }
    const client = createQueryClient()
    return render(
      <QueryClientProvider client={client}>
        <NormalizeSection
          value={over.value ?? cfg}
          open={over.open ?? true}
          onToggle={vi.fn()}
          onChange={over.onChange ?? vi.fn()}
          item={track()}
          selectedCount={over.selectedCount ?? 1}
          format={over.format ?? 'alac'}
        />
      </QueryClientProvider>,
    )
  }

  // The header ⓘ says what the section does, like every other section's. As a button it
  // opened the loudness-metrics help instead, so the sentence it showed promised one thing
  // and the click delivered another.
  it('keeps the header info as a plain note about the section', () => {
    renderWith()
    const info = screen.getByTestId('section-help')
    expect(info).toHaveAttribute('role', 'note')
    expect(info).toHaveTextContent(i18n.t('normalize.editorHint'))
  })

  it('reads the off state as the original loudness', () => {
    renderWith({ open: false, value: cfg })
    expect(screen.getByTestId('normalize-row-sentence')).toHaveTextContent('Original loudness')
    expect(screen.queryByTestId('normalize-active-badge')).not.toBeInTheDocument()
  })

  it('names the target while the measurement is not there', () => {
    renderWith({ open: false, value: loud })
    expect(screen.getByTestId('normalize-row-sentence')).toHaveTextContent('Levels to -14 LUFS')
  })

  // The mode badge sat on the folded header before the sentence came, and stays beside it.
  it('badges the active mode while folded', () => {
    renderWith({ open: false, value: loud })
    expect(screen.getByTestId('normalize-active-badge')).toHaveTextContent(
      i18n.t('normalize.mode.loudness'),
    )
  })

  // The folded header always carried the true-peak ceiling next to the target; the
  // sentence that replaced the bare figures must not lose it.
  it('keeps the true-peak ceiling beside the loudness target', () => {
    renderWith({ open: false, value: loud })
    expect(screen.getByTestId('normalize-row-sentence')).toHaveTextContent(
      `Levels to -14 LUFS · ${loud.truePeakDb} dBTP`,
    )
  })

  // "Where it is now and where it will land" is the whole decision; once the measurement
  // the plan card already runs has landed, the row says both.
  it('says where the track sounds now and where it will come out once measured', async () => {
    renderWith({
      open: false,
      value: loud,
      loudness: { integratedLufs: -21.8, truePeakDb: -3, lra: 6 },
    })
    await waitFor(
      () =>
        expect(screen.getByTestId('normalize-row-sentence')).toHaveTextContent(
          'Plays at -21.8 LUFS, comes out at -14',
        ),
      { timeout: 3000 },
    )
  })

  it('names the peak ceiling in peak mode', () => {
    renderWith({
      open: false,
      value: { mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: -0.1 },
    })
    expect(screen.getByTestId('normalize-row-sentence')).toHaveTextContent('Peak at -0.1 dBFS')
  })

  it('drops the sentence once the section is open', () => {
    renderWith({ open: true, value: loud })
    expect(screen.queryByTestId('normalize-row-sentence')).not.toBeInTheDocument()
  })

  // In a multi-selection the anchor's measurement would pass for the whole batch.
  it('names only the target for a multi-selection', async () => {
    renderWith({
      open: false,
      value: loud,
      selectedCount: 3,
      loudness: { integratedLufs: -21.8, truePeakDb: -3, lra: 6 },
    })
    await new Promise((r) => setTimeout(r, 500))
    expect(screen.getByTestId('normalize-row-sentence')).toHaveTextContent('Levels to -14 LUFS')
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

  // Only ALAC loses the Traktor cues on the re-encode; on every other format a warning
  // would be noise the DJ learns to skip past.
  it('shows no cue warning for a format that keeps the cues', async () => {
    renderWith({ value: loud, format: 'flac' })
    await screen.findByTestId('waveform-solo')
    expect(screen.queryByTestId('normalize-cue-warning')).not.toBeInTheDocument()
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

const measuredLoud = {
  integratedLufs: -16.3,
  truePeakDb: -3.3,
  lra: 6.8,
  channelBalanceDb: null,
  dcOffset: null,
  crestDb: null,
  noiseFloorDb: null,
}

// The prediction already computes `limited` and `gainDb`; the plan line is where those
// facts finally reach the user as a sentence, BEFORE converting. A user emailed asking
// why his files sometimes came out at -1.0 dBTP and sometimes lower: the answer is
// which of these two branches his track took, and nothing in the UI said so.
describe('NormalizeSection plan line', () => {
  it('says the limiter will hold the peaks when the ceiling is in play', async () => {
    renderSection(track(), 1, measuredLoud, { ...cfg, mode: 'loudness', targetLufs: -13 })
    const plan = await screen.findByTestId('normalize-plan')
    expect(plan.dataset.plan).toBe('limited')
    expect(plan.textContent).toContain('limiter')
  })

  it('says a constant gain is enough when the peaks stay under the ceiling', async () => {
    renderSection(
      track(),
      1,
      { ...measuredLoud, integratedLufs: -18.2, truePeakDb: -6.5 },
      { ...cfg, mode: 'loudness', targetLufs: -13 },
    )
    const plan = await screen.findByTestId('normalize-plan')
    expect(plan.dataset.plan).toBe('gain')
    expect(plan.textContent).toContain('never engages')
  })

  it('describes peak mode by where the loudest sample lands', async () => {
    renderSection(track(), 1, measuredLoud, { ...cfg, mode: 'peak' })
    const plan = await screen.findByTestId('normalize-plan')
    expect(plan.dataset.plan).toBe('gain')
    expect(plan.textContent).toContain('loudest sample')
  })

  // No measurement means no honest sentence: the card vanishes rather than promising
  // figures the conversion might contradict — same contract as the readout estimates.
  it('shows no plan without a loudness measurement', async () => {
    renderSection(track(), 1, null, { ...cfg, mode: 'loudness' })
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('normalize-plan')).not.toBeInTheDocument()
  })

  // In multi-select the anchor track's figures would masquerade as the batch's: the
  // scope line above the controls already owns that story.
  it('shows no plan in multi-select', async () => {
    renderSection(track(), 3, measuredLoud, { ...cfg, mode: 'loudness' })
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('normalize-plan')).not.toBeInTheDocument()
  })

  it('shows no plan with normalization off', async () => {
    renderSection(track(), 1, measuredLoud)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('normalize-plan')).not.toBeInTheDocument()
  })
})

describe('NormalizeSection with hints off', () => {
  // First shipped as data-not-help and exempt from the switch, but the user overruled
  // it: an experienced DJ flips ONE persisted switch and the whole section goes quiet,
  // card included. The wait covers the settle delay after which the card would mount.
  it('hides the plan card along with the static hints', async () => {
    renderSection(track(), 1, measuredLoud, { ...cfg, mode: 'loudness', targetLufs: -13 }, false)
    await new Promise((r) => setTimeout(r, 700))
    expect(screen.queryByTestId('normalize-plan')).not.toBeInTheDocument()
    expect(screen.queryByTestId('normalize-mode-line')).not.toBeInTheDocument()
    expect(screen.queryByTestId('normalize-ceiling-caption')).not.toBeInTheDocument()
  })
})

describe('NormalizeSection plan dismissal', () => {
  // The Settings toggle exists, but the user asked for the lever where the eyes are:
  // an X on the card itself that flips the SAME persisted setting — one click quiets
  // the section everywhere, and Settings > Editor is the way back.
  it('offers an X on the card that persists hints off', async () => {
    const hide = vi.fn()
    renderSection(
      track(),
      1,
      measuredLoud,
      { ...cfg, mode: 'loudness', targetLufs: -13 },
      undefined,
      hide,
    )
    const dismiss = await screen.findByTestId('normalize-plan-dismiss')
    fireEvent.click(dismiss)
    expect(hide).toHaveBeenCalledTimes(1)
  })
})

describe('NormalizeSection plan overshoot', () => {
  // A user asked for it after reading the note: knowing THAT the limiter engages is
  // half the story; by how much says how hard it works on this track, which is what
  // decides whether the club target is worth the punch it trades. -16.3 LUFS / -3.3 dBTP
  // to -13 needs +3.3 dB, which lands the peak at 0.0: one full dB over the -1 ceiling.
  it('says by how much the peaks would pass the ceiling', async () => {
    renderSection(track(), 1, measuredLoud, { ...cfg, mode: 'loudness', targetLufs: -13 })
    const plan = await screen.findByTestId('normalize-plan')
    expect(plan.textContent).toContain('by 1.0 dB')
  })
})

// A user asked what the limiter does to the peaks it holds, worried it might squash
// the song. The honest answer depends on how far the peaks would overshoot, and the
// card already computes that: a decibel or two of true-peak trimming touches only
// transients and cannot be heard, while the club target's several dB genuinely trade
// a little punch, which the preset hint already concedes. One sentence for each.
describe('NormalizeSection plan limiter reassurance', () => {
  it('promises inaudibility when the overshoot is small', async () => {
    renderSection(track(), 1, measuredLoud, { ...cfg, mode: 'loudness', targetLufs: -13 })
    const plan = await screen.findByTestId('normalize-plan')
    expect(plan.textContent).toContain('by 1.0 dB')
    expect(plan.textContent).toContain('not audible')
  })

  it('concedes the punch trade when the limiter works hard', async () => {
    renderSection(track(), 1, measuredLoud, { ...cfg, mode: 'loudness', targetLufs: -9 })
    const plan = await screen.findByTestId('normalize-plan')
    expect(plan.textContent).toContain('by 5.0 dB')
    expect(plan.textContent).toContain('less punch')
  })
})
