// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizeConfig, WaveformResult, WaveformScan } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
import '../i18n'
import { AFTER_COLOR, Strip, WaveformCompare, WaveformSolo } from './WaveformCompare'

const wave: WaveformResult = {
  peaks: [0.1, 0.9, 0.4, 1],
  rms: [0.05, 0.45, 0.2, 0.5],
  durationSec: 60,
}

const stereoWave: WaveformResult = {
  peaks: [0.1, 0.9, 0.4, 1],
  rms: [0.05, 0.45, 0.2, 0.5],
  durationSec: 60,
}

// The clip/channel scan now arrives from its own probe (window.api.waveformScan), so the
// clip marks and split lanes are mocked separately from the peaks.
const stereoScan: WaveformScan = {
  clipped: [false, false, false, true],
  channels: [
    { peaks: [0.1, 0.9, 0.4, 1], clipped: [false, false, false, true] },
    { peaks: [0.1, 0.2, 0.3, 0.4], clipped: [false, false, false, false] },
  ],
}

const CFG_NONE: NormalizeConfig = { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const client = createQueryClient()
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  // jsdom has no 2D canvas context (it logs a not-implemented error and returns
  // null); the draw helper already handles null, so stub it to keep the noise out.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
  // jsdom implements no PointerEvent either; aliasing it to MouseEvent lets fireEvent
  // carry clientX into the hover-readout handler (same trick as Waveform.test).
  ;(window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = window.MouseEvent
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('WaveformCompare', () => {
  // The whole point of the pair: the "after" strip must decode the converted file,
  // not re-show the source — that's how a DJ sees what normalization actually did.
  it('decodes and labels both the source and the converted file', async () => {
    const waveform = vi.fn().mockResolvedValue(wave)
    ;(window as unknown as { api: unknown }).api = { waveform, cancelAnalysis: vi.fn() }
    renderWithQuery(<WaveformCompare inputPath="/m/a.wav" outputPath="/out/a.aiff" enabled />)
    expect(await screen.findByTestId('waveform-compare')).toBeInTheDocument()
    expect(screen.getByTestId('waveform-before')).toBeInTheDocument()
    expect(screen.getByTestId('waveform-after')).toBeInTheDocument()
    // Both strips are the open track's own A/B, so they decode at 'high' — the priority
    // useWaveform asks — to jump ahead of any background sweep's 'low' floods.
    await waitFor(() => expect(waveform).toHaveBeenCalledWith('/out/a.aiff', 'high'))
    expect(waveform).toHaveBeenCalledWith('/m/a.wav', 'high')
  })

  // The placeholder must be drawn through the same canvas raster as the real strips
  // (thin mirrored bars), so it previews the wave to come instead of reading as a
  // blocky graphic stamped over the panel.
  it('shows a canvas-drawn decoding skeleton per strip while the peaks are pending', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockReturnValue(new Promise<WaveformResult>(() => {})),
      waveformScan: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformCompare inputPath="/m/a.wav" outputPath="/out/a.aiff" enabled />)
    const skeletons = await screen.findAllByTestId('waveform-compare-loading')
    expect(skeletons).toHaveLength(2)
    for (const skeleton of skeletons) expect(skeleton.tagName).toBe('CANVAS')
  })

  // The full-length decode is the heaviest analysis; a folded-away section must not
  // pay for it. Mirrors the spectrogram/loudness gating in QualitySection.
  it('does not decode while disabled', async () => {
    const waveform = vi.fn().mockResolvedValue(wave)
    ;(window as unknown as { api: unknown }).api = { waveform, cancelAnalysis: vi.fn() }
    renderWithQuery(
      <WaveformCompare inputPath="/m/a.wav" outputPath="/out/a.aiff" enabled={false} />,
    )
    await waitFor(() => expect(screen.getByTestId('waveform-compare')).toBeInTheDocument())
    expect(waveform).not.toHaveBeenCalled()
  })

  // Djotas's ask behind the whole block: after converting, the figures must be the
  // OUTPUT's real measurement, not the source's — that's how you know what
  // normalization actually applied. Each legend carries its own file's numbers.
  it('shows each file’s measured loudness in its legend', async () => {
    const loudness = vi.fn(async (path: string) => ({
      integratedLufs: path === '/out/a.aiff' ? -9.2 : -21.8,
      truePeakDb: path === '/out/a.aiff' ? -0.8 : -18.1,
      lra: 0,
      channelBalanceDb: null,
      dcOffset: null,
      noiseFloorDb: null,
      crestDb: null,
    }))
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue(wave),
      waveformScan: vi.fn().mockResolvedValue(null),
      loudness,
    }
    renderWithQuery(<WaveformCompare inputPath="/m/a.wav" outputPath="/out/a.aiff" enabled />)
    const before = await screen.findByTestId('waveform-before')
    const after = screen.getByTestId('waveform-after')
    await waitFor(() => expect(before).toHaveTextContent('-21.8 LUFS · -18.1 dBTP'))
    expect(after).toHaveTextContent('-9.2 LUFS · -0.8 dBTP')
  })

  // GitHub-style image diff: besides side-by-side, an overlaid view draws both
  // envelopes on one canvas so the gain difference reads directly — the legends
  // (and their figures) stay up regardless of the view.
  it('switches to an overlaid single canvas and back', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue(wave),
      waveformScan: vi.fn().mockResolvedValue(null),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformCompare inputPath="/m/a.wav" outputPath="/out/a.aiff" enabled />)
    expect(await screen.findByTestId('waveform-side')).toBeInTheDocument()
    expect(screen.queryByTestId('waveform-overlay')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('waveform-view-overlay'))
    expect(screen.getByTestId('waveform-overlay')).toBeInTheDocument()
    expect(screen.queryByTestId('waveform-side')).not.toBeInTheDocument()
    expect(screen.getByTestId('waveform-before')).toBeInTheDocument()
    expect(screen.getByTestId('waveform-after')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('waveform-view-side'))
    expect(screen.getByTestId('waveform-side')).toBeInTheDocument()
  })

  // On barely-changed audio the two envelopes cover each other and the overlay reads
  // as one wave — GitHub's onion-skin answer: a fade slider that crossfades the
  // "after" layer over the "before", so scrubbing it makes the difference move.
  it('offers an onion-skin fade slider in the overlaid view only', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue(wave),
      waveformScan: vi.fn().mockResolvedValue(null),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformCompare inputPath="/m/a.wav" outputPath="/out/a.aiff" enabled />)
    await screen.findByTestId('waveform-side')
    expect(screen.queryByTestId('waveform-overlay-fade')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('waveform-view-overlay'))
    const fade = screen.getByTestId('waveform-overlay-fade') as HTMLInputElement
    expect(fade.value).toBe('0.5')
    fireEvent.change(fade, { target: { value: '0' } })
    expect(fade.value).toBe('0')
  })

  // The comparison strips split into L/R lanes too — but only side by side; the
  // overlaid view already stacks two envelopes, and four lanes would be unreadable.
  it('offers the split-channels toggle in the side view only', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue(stereoWave),
      waveformScan: vi.fn().mockResolvedValue(stereoScan),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformCompare inputPath="/m/a.wav" outputPath="/out/a.aiff" enabled />)
    await screen.findByTestId('waveform-side')
    expect(await screen.findByTestId('waveform-split')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByTestId('waveform-view-overlay'))
    expect(screen.queryByTestId('waveform-split')).not.toBeInTheDocument()
  })
})

// The pre-conversion view: the source's wave alone, with the same measured figures,
// so the normalization controls are tuned against what the file actually looks like.
describe('Strip base raster at high zoom', () => {
  // At a deep zoom the base canvas is stretched to zoom×100% of the panel. Rasterizing it
  // to that full width made a canvas tens of thousands of pixels wide (×32 → ~32k px) — a
  // huge GPU bitmap that janked and could spill past its clip while the editor re-rendered
  // (the "waveform smeared across the app" report). Past the hi-res takeover zoom the sharp
  // detail comes from the separate hi-res canvas, so the base only needs a modest raster.
  it('caps the base canvas raster well below the giant full-zoom width when zoomed in', () => {
    // inputPath is what turns the hi-res canvas on past the takeover zoom — a zoomable
    // section always passes it, so the base becomes the mere backdrop the cap applies to.
    const { container } = renderWithQuery(
      <Strip
        wave={wave}
        loading={false}
        loudness={undefined}
        color={AFTER_COLOR}
        inputPath="/m/a.flac"
        zoom={32}
      />,
    )
    // The first canvas is the stretched base (the hi-res one carries data-testid).
    const base = container.querySelector('canvas') as HTMLCanvasElement
    // 600 × 32 would be 19200; the bug's OVERLAY_W path reached ~32640. Capped, the base
    // stays a few thousand pixels while the hi-res canvas covers the fine detail.
    expect(base.width).toBeLessThanOrEqual(8192)
  })

  it('keeps the full base raster at 1× where there is no hi-res canvas', () => {
    const { container } = renderWithQuery(
      <Strip wave={wave} loading={false} loudness={undefined} color={AFTER_COLOR} zoom={1} />,
    )
    const base = container.querySelector('canvas') as HTMLCanvasElement
    // At 1× the base IS the wave the user sees, so it keeps its full base raster
    // (the default CANVAS_W of the side-by-side columns).
    expect(base.width).toBe(600)
  })
})

describe('Strip view reporting', () => {
  // An overlay that renders only what shows needs the window the strip already
  // tracks internally; the callback hands it out without the overlay re-deriving
  // scroll math.
  it('reports the visible window to onViewChange', async () => {
    const onViewChange = vi.fn()
    renderWithQuery(
      <Strip
        wave={wave}
        loading={false}
        loudness={undefined}
        color={AFTER_COLOR}
        onViewChange={onViewChange}
      />,
    )
    await waitFor(() => expect(onViewChange).toHaveBeenCalledWith({ from: 0, to: 1 }))
  })

  // The dropped-audio shade lets a section that shows the whole file (declick,
  // loudness) still say which head and tail the staged trim will
  // cut — dimmed, so the wave never reshapes and a grid anchored to the original
  // file doesn't jump.
  it('shades the trimmed head and tail as fractions of the strip', () => {
    renderWithQuery(
      <Strip
        wave={wave}
        loading={false}
        loudness={undefined}
        color={AFTER_COLOR}
        trimShade={{ startFrac: 0.1, endFrac: 0.25 }}
      />,
    )
    expect(screen.getByTestId('waveform-trim-shade-start')).toHaveStyle({ width: '10%' })
    expect(screen.getByTestId('waveform-trim-shade-end')).toHaveStyle({ width: '25%' })
  })

  // No trim, no shade: an untrimmed track must not dim any of its own wave.
  it('draws no shade without a staged trim', () => {
    renderWithQuery(<Strip wave={wave} loading={false} loudness={undefined} color={AFTER_COLOR} />)
    expect(screen.queryByTestId('waveform-trim-shade-start')).not.toBeInTheDocument()
    expect(screen.queryByTestId('waveform-trim-shade-end')).not.toBeInTheDocument()
  })

  // A cut on only one side shades only that side.
  it('shades only the side that is trimmed', () => {
    renderWithQuery(
      <Strip
        wave={wave}
        loading={false}
        loudness={undefined}
        color={AFTER_COLOR}
        trimShade={{ startFrac: 0.15 }}
      />,
    )
    expect(screen.getByTestId('waveform-trim-shade-start')).toBeInTheDocument()
    expect(screen.queryByTestId('waveform-trim-shade-end')).not.toBeInTheDocument()
  })
})

describe('WaveformSolo', () => {
  it('decodes the source and shows its measured figures', async () => {
    const waveform = vi.fn().mockResolvedValue(wave)
    const loudness = vi.fn().mockResolvedValue({
      integratedLufs: -7.4,
      truePeakDb: 0.2,
      lra: 0,
      channelBalanceDb: null,
      dcOffset: null,
      noiseFloorDb: null,
      crestDb: null,
    })
    ;(window as unknown as { api: unknown }).api = { waveform, loudness, cancelAnalysis: vi.fn() }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled clipDb={-1} normalize={CFG_NONE} />)
    const solo = await screen.findByTestId('waveform-solo')
    await waitFor(() => expect(solo).toHaveTextContent('-7.4 LUFS · 0.2 dBTP'))
    // The solo strip is the open track's own wave, so it decodes at 'high'.
    expect(waveform).toHaveBeenCalledWith('/m/a.wav', 'high')
  })

  it('does not decode while disabled', async () => {
    const waveform = vi.fn().mockResolvedValue(wave)
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform,
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(
      <WaveformSolo inputPath="/m/a.wav" enabled={false} clipDb={-1} normalize={CFG_NONE} />,
    )
    await waitFor(() => expect(screen.getByTestId('waveform-solo')).toBeInTheDocument())
    expect(waveform).not.toHaveBeenCalled()
  })

  // Djotas's peaks: the strip marks where the wave pokes over the active ceiling in
  // red, and the legend names the ceiling so the marks aren't a mystery color. No
  // clipping peak, no legend — a clean track must not warn.
  it('flags peaks over the ceiling in the legend', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      // 1.0 and 0.9 poke over -1 dB (0.891); the label carries the ceiling value.
      waveform: vi.fn().mockResolvedValue({ peaks: [0.1, 0.9, 0.4, 1], durationSec: 60 }),
      waveformScan: vi.fn().mockResolvedValue(null),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled clipDb={-1} normalize={CFG_NONE} />)
    expect(await screen.findByTestId('waveform-clipped')).toHaveTextContent('-1')
  })

  // With normalization off there is no dB line at all: the marks come from the
  // decoder's per-bucket true-clipping flags (native-rate samples pinned at full
  // scale, Audacity's exact criterion) and the label reads "Clipping".
  it('labels the decoded clipping flags as clipping', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue({ peaks: [0.1, 0.9, 0.4, 1], durationSec: 60 }),
      waveformScan: vi.fn().mockResolvedValue({ clipped: [false, false, false, true] }),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled normalize={CFG_NONE} />)
    expect(await screen.findByTestId('waveform-clipped')).toHaveTextContent('Clipping')
  })

  it('shows no clip flag for a hot master whose samples never pin full scale', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      // The envelope rides near full scale — loud mastering — but the decoder found
      // no pinned samples. Envelope thresholds painted tracks like this solid red;
      // the flags say what actually clipped: nothing.
      waveform: vi.fn().mockResolvedValue({ peaks: [0.9886, 0.995, 0.999], durationSec: 60 }),
      waveformScan: vi.fn().mockResolvedValue({ clipped: [false, false, false] }),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled normalize={CFG_NONE} />)
    await screen.findByTestId('waveform-solo')
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('waveform-clipped')).not.toBeInTheDocument()
  })

  it('shows no clip flag when the decoder could not scan for clipping', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      // No `clipped` field at all (the scan failed): no honest data, no red — the
      // envelope alone must never be promoted back into a clipping verdict.
      waveform: vi.fn().mockResolvedValue({ peaks: [0.1, 0.9, 1], durationSec: 60 }),
      waveformScan: vi.fn().mockResolvedValue(null),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled normalize={CFG_NONE} />)
    await screen.findByTestId('waveform-solo')
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('waveform-clipped')).not.toBeInTheDocument()
  })

  it('shows no clip flag when the wave stays under the ceiling', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue({ peaks: [0.1, 0.5, 0.4], durationSec: 60 }),
      waveformScan: vi.fn().mockResolvedValue(null),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled clipDb={-1} normalize={CFG_NONE} />)
    await screen.findByTestId('waveform-solo')
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('waveform-clipped')).not.toBeInTheDocument()
  })

  // The legend doubles as the switch: a click hides the red marks (a busy vinyl rip
  // can be mostly red), another brings them back. The label stays up either way so
  // the way back is obvious.
  it('toggles the clip marks from the legend', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue(wave),
      waveformScan: vi.fn().mockResolvedValue(null),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled clipDb={-1} normalize={CFG_NONE} />)
    const flag = await screen.findByTestId('waveform-clipped')
    expect(flag).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(flag)
    expect(screen.getByTestId('waveform-clipped')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByTestId('waveform-clipped'))
    expect(screen.getByTestId('waveform-clipped')).toHaveAttribute('aria-pressed', 'true')
  })

  // The same switch rides along in the previews, counting on the PREDICTED wave:
  // dialing the loudness target up makes the flag (and its red marks) appear as
  // peaks cross the true-peak ceiling — the feedback that finds the optimal value.
  it('flags predicted peaks over the ceiling in the loudness preview', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue(wave),
      waveformScan: vi.fn().mockResolvedValue(null),
      // +6 dB to -14: 0.9 and 1.0 scale past the -1 dBTP ceiling (0.891).
      loudness: vi.fn().mockResolvedValue({
        integratedLufs: -20,
        truePeakDb: -8,
        lra: 0,
        channelBalanceDb: null,
        dcOffset: null,
        noiseFloorDb: null,
        crestDb: null,
      }),
    }
    renderWithQuery(
      <WaveformSolo
        inputPath="/m/a.wav"
        enabled
        clipDb={-1}
        normalize={{ mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }}
      />,
    )
    const flag = await screen.findByTestId('waveform-clipped')
    expect(flag).toHaveTextContent('-1')
    expect(flag).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(flag)
    expect(screen.getByTestId('waveform-clipped')).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows no flag when the loudness preview stays under its ceiling', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue(wave),
      waveformScan: vi.fn().mockResolvedValue(null),
      // -6 dB to -14: everything lands well under the ceiling.
      loudness: vi.fn().mockResolvedValue({
        integratedLufs: -8,
        truePeakDb: 0,
        lra: 0,
        channelBalanceDb: null,
        dcOffset: null,
        noiseFloorDb: null,
        crestDb: null,
      }),
    }
    renderWithQuery(
      <WaveformSolo
        inputPath="/m/a.wav"
        enabled
        clipDb={-1}
        normalize={{ mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }}
      />,
    )
    await screen.findByTestId('waveform-preview')
    expect(screen.queryByTestId('waveform-clipped')).not.toBeInTheDocument()
  })

  // Peak mode marks against digital clipping: a target past 0 dBFS is the one way
  // this mode can ruin a file, so red appearing is the "too far" signal.
  it('flags a peak target past digital clipping in the peak preview', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue(wave),
      waveformScan: vi.fn().mockResolvedValue(null),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(
      <WaveformSolo
        inputPath="/m/a.wav"
        enabled
        clipDb={-1}
        normalize={{ mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: 1.8 }}
      />,
    )
    const flag = await screen.findByTestId('waveform-clipped')
    // The peak preview's line IS digital clipping, so it carries the same wording.
    expect(flag).toHaveTextContent('Clipping')
  })

  it('shows no flag for a peak target at or under full scale', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue(wave),
      waveformScan: vi.fn().mockResolvedValue(null),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(
      <WaveformSolo
        inputPath="/m/a.wav"
        enabled
        clipDb={-1}
        normalize={{ mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: -1 }}
      />,
    )
    await screen.findByTestId('waveform-preview')
    expect(screen.queryByTestId('waveform-clipped')).not.toBeInTheDocument()
  })

  // Hovering the strip reads out the exact spot: the time under the cursor and that
  // bucket's level in dB — red when it pokes over the active ceiling — so a DJ can
  // pin down where a clip sits without converting or opening the player.
  it('reads out time and level under the cursor', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue(wave),
      waveformScan: vi.fn().mockResolvedValue(null),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled clipDb={-1} normalize={CFG_NONE} />)
    const strip = await screen.findByTestId('waveform-strip')
    // Hovering before the decode lands has nothing to read out; wait for the peaks.
    await waitFor(() =>
      expect(screen.queryByTestId('waveform-compare-loading')).not.toBeInTheDocument(),
    )
    strip.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: 0, height: 48, right: 200, bottom: 48, x: 0, y: 0 }) as DOMRect
    fireEvent.pointerMove(strip, { clientX: 150 })
    const readout = screen.getByTestId('waveform-hover')
    // 75% of 60 s = 0:45; bucket 3 of [0.1, 0.9, 0.4, 1] = 1.0 → 0.0 dB.
    expect(readout).toHaveTextContent('0:45')
    expect(readout).toHaveTextContent('0.0 dB')

    fireEvent.pointerLeave(strip)
    expect(screen.queryByTestId('waveform-hover')).not.toBeInTheDocument()
  })

  // With Loudness or Peak dialed in, the strip previews the outcome before any
  // conversion: the original stays behind in grey, the predicted envelope draws in
  // front, and the legend names the target it aims for.
  it('previews the loudness outcome over the original once measured', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue(wave),
      waveformScan: vi.fn().mockResolvedValue(null),
      loudness: vi.fn().mockResolvedValue({
        integratedLufs: -20,
        truePeakDb: -8,
        lra: 0,
        channelBalanceDb: null,
        dcOffset: null,
        noiseFloorDb: null,
        crestDb: null,
      }),
    }
    renderWithQuery(
      <WaveformSolo
        inputPath="/m/a.wav"
        enabled
        clipDb={-1}
        normalize={{ mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }}
      />,
    )
    const legend = await screen.findByTestId('waveform-preview')
    expect(legend).toHaveTextContent('-14.0 LUFS')
    expect(legend).toHaveTextContent('-1.0 dBTP')
    // The felt number — how hard the normalization pushes (-20 measured to -14) —
    // lives in its own chip now, signed so a boost and a cut read apart at a glance,
    // instead of trailing the target figures as one more dot-separated number.
    // The felt number lives in its OWN testid'd chip now — found on its own, not by
    // fishing it out of the legend's figures — signed so a boost and a cut read apart
    // at a glance instead of trailing the targets as one more dot-separated number.
    const delta = await screen.findByTestId('waveform-gain-delta')
    expect(delta).toHaveTextContent('+6.0 dB')
  })

  it('shows no preview while normalization is off', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue(wave),
      waveformScan: vi.fn().mockResolvedValue(null),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled clipDb={-1} normalize={CFG_NONE} />)
    await screen.findByTestId('waveform-solo')
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('waveform-preview')).not.toBeInTheDocument()
  })

  // rekordbox-style zoom: + stretches the strip inside a horizontal scroller so a
  // clip can be pinned down bar by bar; − steps back; the ×N label resets. The
  // envelope is still the decoded buckets — zoom widens them, it never re-reads.
  it('zooms the strip in steps and scrolls horizontally', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue(wave),
      waveformScan: vi.fn().mockResolvedValue(null),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled clipDb={-1} normalize={CFG_NONE} />)
    const strip = await screen.findByTestId('waveform-strip')
    expect(strip).toHaveStyle({ width: '100%' })
    expect(screen.getByTestId('waveform-zoom-out')).toBeDisabled()

    fireEvent.click(screen.getByTestId('waveform-zoom-in'))
    expect(screen.getByTestId('waveform-strip')).toHaveStyle({ width: '200%' })

    for (let i = 0; i < 7; i++) fireEvent.click(screen.getByTestId('waveform-zoom-in'))
    expect(screen.getByTestId('waveform-strip')).toHaveStyle({ width: '25600%' })
    expect(screen.getByTestId('waveform-zoom-in')).toBeDisabled()

    fireEvent.click(screen.getByTestId('waveform-zoom-out'))
    expect(screen.getByTestId('waveform-strip')).toHaveStyle({ width: '12800%' })
  })

  it('resets the zoom from the factor label', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue(wave),
      waveformScan: vi.fn().mockResolvedValue(null),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled clipDb={-1} normalize={CFG_NONE} />)
    await screen.findByTestId('waveform-strip')
    expect(screen.getByTestId('waveform-zoom-reset')).toBeDisabled()
    fireEvent.click(screen.getByTestId('waveform-zoom-in'))
    fireEvent.click(screen.getByTestId('waveform-zoom-in'))
    const reset = screen.getByTestId('waveform-zoom-reset')
    expect(reset).toHaveTextContent('×4')
    fireEvent.click(reset)
    expect(screen.getByTestId('waveform-strip')).toHaveStyle({ width: '100%' })
  })

  // Trackpad pinch (a ctrlKey wheel in the browser's eyes) zooms the strip
  // continuously without reaching for the buttons — the DAW muscle memory. A plain
  // wheel must NOT zoom: it stays the scroller's horizontal pan.
  it('pinch-zooms the strip and ignores plain wheel scrolling', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue(wave),
      waveformScan: vi.fn().mockResolvedValue(null),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled clipDb={-1} normalize={CFG_NONE} />)
    const strip = await screen.findByTestId('waveform-strip')
    const scroller = strip.parentElement as HTMLElement
    fireEvent.wheel(scroller, { deltaY: -100, ctrlKey: true })
    // exp(100 × 0.01) ≈ 2.72 — the label rounds the continuous factor to tenths.
    expect(screen.getByTestId('waveform-zoom-reset')).toHaveTextContent('×2.7')
    fireEvent.wheel(scroller, { deltaY: -100 })
    expect(screen.getByTestId('waveform-zoom-reset')).toHaveTextContent('×2.7')
  })

  // Zoomed in, "where am I in the track" needs an answer without dragging the hover
  // chip around — the ruler appears with the zoom and stays out of the ×1 overview.
  it('shows the time ruler only while zoomed', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue(wave),
      waveformScan: vi.fn().mockResolvedValue(null),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled clipDb={-1} normalize={CFG_NONE} />)
    await screen.findByTestId('waveform-strip')
    expect(screen.queryByTestId('waveform-ruler')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('waveform-zoom-in'))
    expect(screen.getByTestId('waveform-ruler')).toBeInTheDocument()
  })

  // Audacity-style stacked L/R lanes: the decoder ships per-channel envelopes and
  // clip flags for stereo files, and the toggle flips the strip between the mono
  // overview and the two lanes — a clip that lives in one channel only reads there.
  it('offers the split-channels toggle for stereo waves and flips it', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue(stereoWave),
      waveformScan: vi.fn().mockResolvedValue(stereoScan),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled normalize={CFG_NONE} />)
    const toggle = await screen.findByTestId('waveform-split')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    const canvas = (): HTMLCanvasElement => {
      const el = screen.getByTestId('waveform-strip').querySelector('canvas')
      if (!el) throw new Error('strip canvas missing')
      return el
    }
    // Half the strip per lane would squash each channel to half the mono wave's
    // size, so splitting grows the strip: every lane keeps a readable height.
    expect(canvas().className).toContain('h-24')
    fireEvent.click(toggle)
    expect(screen.getByTestId('waveform-split')).toHaveAttribute('aria-pressed', 'true')
    expect(canvas().className).toContain('h-36')
    fireEvent.click(screen.getByTestId('waveform-split'))
    expect(screen.getByTestId('waveform-split')).toHaveAttribute('aria-pressed', 'false')
    expect(canvas().className).toContain('h-24')
  })

  it('hides the split toggle when the decoder shipped no channel lanes', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      // A mono file, or a failed scan: nothing honest to split into lanes.
      waveform: vi.fn().mockResolvedValue(wave),
      waveformScan: vi.fn().mockResolvedValue(null),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled normalize={CFG_NONE} />)
    await screen.findByTestId('waveform-strip')
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('waveform-split')).not.toBeInTheDocument()
  })

  // The loudness preview needs the measurement; until it lands the strip stays the
  // plain original rather than guessing a gain from nothing.
  it('shows no loudness preview before the measurement lands', async () => {
    ;(window as unknown as { api: unknown }).api = {
      cancelAnalysis: vi.fn(),
      waveform: vi.fn().mockResolvedValue(wave),
      waveformScan: vi.fn().mockResolvedValue(null),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(
      <WaveformSolo
        inputPath="/m/a.wav"
        enabled
        clipDb={-1}
        normalize={{ mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }}
      />,
    )
    await screen.findByTestId('waveform-solo')
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('waveform-preview')).not.toBeInTheDocument()
  })
})
