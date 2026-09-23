// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizeConfig, SpectrumResult } from '../../../shared/types'
import i18n from '../i18n'
import { createQueryClient } from '../lib/queryClient'
import { ToastProvider } from '../lib/toastContext'
import type { TrackItem } from '../types'
import { QualitySection } from './QualitySection'

// The report composition is canvas work jsdom can't run; a plain stub (not vi.fn — the
// restoreAllMocks in beforeEach would wipe a vi.fn's implementation) returns a
// recognisable data URL so the tests can assert what reaches the export dialog.
const reportInputs = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock('../lib/qualityReport', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  renderQualityReport: (input: Record<string, unknown>) => {
    reportInputs.push(input)
    return Promise.resolve('data:image/png;base64,report')
  },
}))

afterEach(cleanup)

// These cases are about the spectrogram, and mount with the loudness table off; with
// normalization off too, nothing here draws a post-conversion estimate.
const OFF: NormalizeConfig = { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

function track(inputPath = '/music/a.flac'): TrackItem {
  const fileName = inputPath.split('/').pop() ?? inputPath
  return {
    id: 'a',
    inputPath,
    fileName,
    listLabel: fileName,
    query: '',
    status: 'idle',
    meta: {
      title: '',
      artist: '',
      album: '',
      albumArtist: '',
      year: '',
      genre: '',
      grouping: '',
      comment: '',
      trackNumber: '',
      discNumber: '',
      bpm: '',
      key: '',
      publisher: '',
      catalogNumber: '',
      remixArtist: '',
    },
  }
}

function renderSection(
  spectrum: SpectrumResult,
  inputPath?: string,
  showHints = true,
  outputSampleRate: 'source' | '44100' | '48000' | 'corrected' = 'source',
): void {
  ;(window as unknown as { api: unknown }).api = {
    spectrogram: vi.fn().mockResolvedValue(spectrum),
  }
  const client = createQueryClient()
  render(
    <QueryClientProvider client={client}>
      <QualitySection
        item={track(inputPath)}
        showSpectrum
        showLoudness={false}
        normalize={OFF}
        open
        onToggle={vi.fn()}
        onShowLoudnessHelp={vi.fn()}
        showHints={showHints}
        outputSampleRate={outputSampleRate}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// Folding the section away must stop its (heavy) decode, not just hide the result — the
// whole point of the collapse is "not now". So a closed section never calls ffmpeg.
describe('QualitySection analysis gating', () => {
  it('does not analyze while the section is collapsed', async () => {
    const spectrogram = vi
      .fn()
      .mockResolvedValue({ image: '', cutoffHz: 21000, sampleRateHz: 44100, processed: false })
    ;(window as unknown as { api: unknown }).api = { spectrogram }
    const client = createQueryClient()
    render(
      <QueryClientProvider client={client}>
        <QualitySection
          item={track()}
          showSpectrum
          showLoudness={false}
          normalize={OFF}
          open={false}
          onToggle={vi.fn()}
          onShowLoudnessHelp={vi.fn()}
        />
      </QueryClientProvider>,
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(spectrogram).not.toHaveBeenCalled()
  })

  // The editor only mounts this for the selected track — the one the user is waiting on.
  // During an auto-match sweep the background floods the analysis limiter with 'low'
  // decodes, so the selected track's spectrum must ask for 'high' to jump the queue,
  // otherwise it stalls on "Analyzing spectrum…" behind the whole crate.
  it('requests the selected track spectrum at high priority', async () => {
    const spectrogram = vi
      .fn()
      .mockResolvedValue({ image: '', cutoffHz: 21000, sampleRateHz: 44100, processed: false })
    ;(window as unknown as { api: unknown }).api = { spectrogram }
    const client = createQueryClient()
    render(
      <QueryClientProvider client={client}>
        <QualitySection
          item={track()}
          showSpectrum
          showLoudness={false}
          normalize={OFF}
          open
          onToggle={vi.fn()}
          onShowLoudnessHelp={vi.fn()}
        />
      </QueryClientProvider>,
    )
    await vi.waitFor(() => expect(spectrogram).toHaveBeenCalled())
    expect(spectrogram).toHaveBeenCalledWith('/music/a.flac', 'high')
  })

  // Arrowing down a crate with Quality open remounts this section per row. The spectrum
  // is the heaviest probe in the app (a full decode plus an FFT), and it was the only
  // one firing without waiting for the selection to rest — so passing over ten rows
  // queued ten decodes for tracks the user never stopped on. Every other heavy probe
  // here (loudness, bpm, key, trim, declick) already waits; this one now does too.
  it('waits for the selection to rest before decoding a track just passed over', async () => {
    const spectrogram = vi
      .fn()
      .mockResolvedValue({ image: '', cutoffHz: 21000, sampleRateHz: 44100, processed: false })
    ;(window as unknown as { api: unknown }).api = { spectrogram }
    const client = createQueryClient()
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <QualitySection
          item={track()}
          showSpectrum
          showLoudness={false}
          normalize={OFF}
          open
          onToggle={vi.fn()}
          onShowLoudnessHelp={vi.fn()}
        />
      </QueryClientProvider>,
    )
    // Unmount well inside the settle window, the way the editor remounts when the
    // selection moves on: the row was passed over, so it must never have decoded.
    await new Promise((r) => setTimeout(r, 50))
    unmount()
    await new Promise((r) => setTimeout(r, 500))
    expect(spectrogram).not.toHaveBeenCalled()
  })
})

// The caption under the spectrogram is the only place that explains the verdict, so
// it must say WHY this file earned its colour — a generic one-liner reads the same
// under a green badge and a red one, leaving "Bad quality" unjustified.
describe('QualitySection verdict caption', () => {
  it('explains a bad verdict as a lossy signature for an ambiguous container', async () => {
    // .m4a can hold AAC or ALAC, so the extension promises nothing: it is graded on the
    // strict scale and gets the plain bad caption rather than the transcode one, which is
    // reserved for containers that are lossless by definition.
    renderSection({ image: '', cutoffHz: 16000, sampleRateHz: 44100, processed: false }, '/m/a.m4a')
    expect(
      await screen.findByText(i18n.t('editor.qualityCaptionBad', { cutoff: '16.0 kHz' })),
    ).toBeInTheDocument()
  })

  it('explains a warn verdict as the high-bitrate-lossy ambiguity zone', async () => {
    renderSection({ image: '', cutoffHz: 18000, sampleRateHz: 44100, processed: false }, '/m/a.m4a')
    expect(
      await screen.findByText(i18n.t('editor.qualityCaptionWarn', { cutoff: '18.0 kHz' })),
    ).toBeInTheDocument()
  })

  // Surco measures where the spectrum stops, not the source bitrate — the two only
  // correlate. A YouTube 128 upscaled to 320 leaves sparse highs that push the measured
  // line up, so a confident "~192 kbps" guess reads as wrong to anyone who knows the file.
  // The captions for the inconclusive verdicts (good = reaches the line, warn = short of it)
  // must describe the observation, never name a bitrate — a guess an expert spots instantly.
  // The bad/transcode captions are exempt: a detected knee IS a lossy signature, so naming
  // it is a measurement, not a guess.
  it.each(['editor.qualityCaptionGood', 'editor.qualityCaptionWarn'])(
    'does not pin a specific source bitrate in %s',
    (key) => {
      expect(i18n.t(key, { cutoff: '19.0 kHz' })).not.toMatch(/kbps/)
    },
  )

  // For sound engineers the caption is a data readout, not coaching: it states what was
  // measured and stops. The spectrogram above it already invites a listen, so an advice
  // clause ("give it a listen before you play it") is noise that pads the line. Guard both
  // locales so a future reword can't quietly bring the coaching back.
  const CAPTION_KEYS = [
    'editor.qualityCaptionGood',
    'editor.qualityCaptionWarn',
    'editor.qualityCaptionBad',
    'editor.qualityCaptionProcessed',
    'editor.qualityCaptionGenuine',
    'editor.qualityCaptionTranscode',
  ]
  it.each(CAPTION_KEYS)('keeps %s a fact, with no listen-before-you-play advice', (key) => {
    for (const lng of ['en', 'es']) {
      const text = i18n.getFixedT(lng)(key, { cutoff: '19.0 kHz' })
      expect(text).not.toMatch(/listen|escúcha|antes de pinchar|before you play/i)
    }
  })

  // A full-band good verdict is already said twice on screen — the green badge and
  // the cutoff chip on the spectrogram — so the caption would be the third telling.
  // It stays reserved for verdicts that need justifying (warn/bad/processed/genuine).
  it('shows no caption for a plain full-band good verdict', async () => {
    renderSection({ image: '', cutoffHz: 21000, sampleRateHz: 44100, processed: false })
    await screen.findByTestId('quality-badge')
    expect(
      screen.queryByText(i18n.t('editor.qualityCaptionGood', { cutoff: '21.0 kHz' })),
    ).not.toBeInTheDocument()
  })

  // The report action lives in the section header as a quiet icon — a rare action on
  // its own bordered row cost a full row of height under an already-tall spectrogram.
  it('offers the report from the header, above the spectrogram', async () => {
    renderSection(
      { image: 'data:image/png;base64,x', cutoffHz: 21000, sampleRateHz: 44100, processed: false },
      '/m/a.flac',
    )
    const button = await screen.findByTestId('quality-save-report')
    const spectrogram = screen.getByTestId('spectrogram')
    expect(
      button.compareDocumentPosition(spectrogram) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  // The save crosses IPC to write a file, so it fails for ordinary reasons — no permission,
  // a full disk. It used to console.error and stop: the spinner finished, no file appeared,
  // and nothing was said, which reads exactly like success. Whatever else happens, the user
  // who pressed the button has to be told it didn't work.
  it('tells the user when the report cannot be saved', async () => {
    const reportError = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(window as unknown as { api: unknown }).api = {
      spectrogram: vi
        .fn()
        .mockResolvedValue({ image: 'x', cutoffHz: 21000, sampleRateHz: 44100, processed: false }),
      exportQualityReport: vi.fn().mockRejectedValue(new Error('EACCES')),
    }
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider value={{ reportError }}>
          <QualitySection
            item={track('/m/a.flac')}
            showSpectrum
            showLoudness={false}
            normalize={OFF}
            open
            onToggle={vi.fn()}
            onShowLoudnessHelp={vi.fn()}
            showHints
          />
        </ToastProvider>
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByTestId('quality-save-report'))

    await waitFor(() => expect(reportError).toHaveBeenCalledWith(i18n.t('errors.qualityReport')))
  })

  it('flags regenerated highs with a Reprocessed badge, not Bad quality over cutoff boilerplate', async () => {
    // The enhancer hump reaches past the good line, so a "full spectrum" view under
    // a "Bad quality" badge reads as a contradiction. The processed case gets its
    // own badge naming the manipulation, paired with its enhancer caption.
    renderSection({ image: '', cutoffHz: 16000, sampleRateHz: 44100, processed: true })
    expect(
      await screen.findByText(i18n.t('editor.qualityCaptionProcessed', { cutoff: '16.0 kHz' })),
    ).toBeInTheDocument()
    expect(screen.getByTestId('quality-badge')).toHaveTextContent(i18n.t('editor.qualityProcessed'))
  })

  it('passes a knee-free dark master as good, with the genuine-master caption not the warn one', async () => {
    // A real false positive: a genuine master tapers smoothly to ~18 kHz with no
    // codec knee. It must read as Good quality, and the caption must explain it is a
    // gently rolled-off but genuine master — not the "~192 kbps source" warn text.
    renderSection({
      image: '',
      cutoffHz: 18000,
      sampleRateHz: 44100,
      processed: false,
      hasKnee: false,
    })
    expect(
      await screen.findByText(i18n.t('editor.qualityCaptionGenuine', { cutoff: '18.0 kHz' })),
    ).toBeInTheDocument()
    expect(screen.getByTestId('quality-badge')).toHaveTextContent(i18n.t('editor.qualityGood'))
  })

  it('shows the upsample note when a high-rate file walls off at 22.05 kHz', async () => {
    // Orthogonal to the codec verdict: a 48 kHz file whose real bandwidth ends at
    // 22.05 kHz is upsampled from 44.1 kHz. The note must appear so a green badge
    // does not read as a clean bill of hi-res.
    renderSection({
      image: '',
      cutoffHz: 20000,
      sampleRateHz: 48000,
      processed: false,
      hasKnee: false,
      upsampled: true,
    })
    expect(await screen.findByTestId('quality-upsampled')).toHaveTextContent(
      i18n.t('editor.qualityUpsampled'),
    )
  })

  // The headline case for a DJ: a .flac that is really a re-encoded lossy file. A codec
  // knee can't occur in genuine lossless, so the badge names the fraud ("Fake lossless")
  // rather than the generic "Bad quality", and the caption says the container is lying.
  it('flags a lossless file with a codec knee as a fake-lossless transcode', async () => {
    renderSection(
      { image: '', cutoffHz: 16000, sampleRateHz: 44100, processed: false, hasKnee: true },
      '/music/a.flac',
    )
    expect(await screen.findByTestId('quality-badge')).toHaveTextContent(
      i18n.t('editor.qualityTranscode'),
    )
    expect(
      screen.getByText(i18n.t('editor.qualityCaptionTranscode', { cutoff: '16.0 kHz' })),
    ).toBeInTheDocument()
  })

  // The same knee in a lossy container is the format working as designed, not a fraud and
  // not a defect: the badge stays green, and the caption is where the low bitrate is
  // reported. Grading it red taught users to distrust files that were exactly what they
  // claimed to be — the reported complaint this gating exists to prevent.
  it('keeps a lossy container green and reports its cut in the caption', async () => {
    renderSection(
      { image: '', cutoffHz: 16000, sampleRateHz: 44100, processed: false, hasKnee: true },
      '/music/a.mp3',
    )
    expect(await screen.findByTestId('quality-badge')).toHaveTextContent(
      i18n.t('editor.qualityGood'),
    )
    expect(
      screen.getByText(i18n.t('editor.qualityCaptionLossy', { cutoff: '16.0 kHz' })),
    ).toBeInTheDocument()
  })

  it('shows no upsample note for a genuine high-rate file', async () => {
    renderSection({
      image: '',
      cutoffHz: 20000,
      sampleRateHz: 48000,
      processed: false,
      hasKnee: false,
      upsampled: false,
    })
    await screen.findByTestId('quality-badge')
    expect(screen.queryByTestId('quality-upsampled')).not.toBeInTheDocument()
  })

  // The reported gap: a real 192 kHz file said nothing at all about its rate, so "checked and
  // the content is genuinely there" looked identical to "never analysed". A confirmed hi-res
  // file now says so, and must not be mistaken for the upsample accusation.
  it('confirms a verified hi-res file instead of staying silent about its rate', async () => {
    renderSection({
      image: '',
      cutoffHz: 22050,
      sampleRateHz: 192000,
      processed: false,
      hasKnee: false,
      upsampled: false,
      resolution: 'hires',
    })
    expect(await screen.findByTestId('quality-hires')).toBeInTheDocument()
    expect(screen.queryByTestId('quality-upsampled')).not.toBeInTheDocument()
  })

  // The honest third state: an unreadable probe proves nothing either way, and dressing that
  // up as a pass would be inventing a verdict nobody measured.
  it('says the rate could not be verified rather than implying it passed', async () => {
    renderSection({
      image: '',
      cutoffHz: 22050,
      sampleRateHz: 192000,
      processed: false,
      hasKnee: false,
      upsampled: false,
      resolution: 'unknown',
    })
    expect(await screen.findByTestId('quality-resolution-unknown')).toBeInTheDocument()
    expect(screen.queryByTestId('quality-hires')).not.toBeInTheDocument()
  })

  // A plain 44.1 kHz file makes no hi-res claim, so it must not gain a line telling the user
  // something they did not ask about and that carries no signal.
  it('stays silent about the rate on a native 44.1 kHz file', async () => {
    renderSection({
      image: '',
      cutoffHz: 20000,
      sampleRateHz: 44100,
      processed: false,
      hasKnee: false,
      upsampled: false,
      resolution: 'native',
    })
    await screen.findByTestId('quality-badge')
    expect(screen.queryByTestId('quality-hires')).not.toBeInTheDocument()
    expect(screen.queryByTestId('quality-resolution-unknown')).not.toBeInTheDocument()
  })
})

// Red is alarming, so it is kept for the two verdicts that are measured and serious: a
// lossy source inside a lossless container, and a bad-quality cut. Everything the
// detectors only suspect is amber, and the padded-depth fact is neutral.
describe('verdict colours', () => {
  it.each([
    [{ cutoffHz: 16000, hasKnee: true }, '/m/a.flac', 'danger'],
    [{ cutoffHz: 16000, hasKnee: true }, '/m/a.m4a', 'danger'],
    [{ cutoffHz: 18500, hasKnee: true }, '/m/a.m4a', 'warn'],
    [{ cutoffHz: 16000, processed: true }, '/m/a.flac', 'warn'],
  ])('paints %o in %s as %s', async (fields, path, tone) => {
    renderSection({ image: '', sampleRateHz: 44100, processed: false, ...fields }, path)
    expect(await screen.findByTestId('quality-badge')).toHaveAttribute('data-tone', tone)
  })

  it('names a regenerated-highs verdict as a possibility, not a fact', () => {
    expect(i18n.t('editor.qualityProcessed')).toBe('Possibly reprocessed')
  })

  it('argues regenerated highs in amber, matching the pill', async () => {
    renderSection(
      { image: '', cutoffHz: 16000, sampleRateHz: 44100, processed: true, humpPeakHz: 19000 },
      '/m/a.flac',
    )
    expect(await screen.findByTestId('quality-evidence')).toHaveAttribute('data-tone', 'warn')
  })

  it('states padded depth as a neutral fact, pill and block alike', async () => {
    renderSection(
      {
        image: '',
        cutoffHz: 21000,
        sampleRateHz: 44100,
        processed: false,
        hasKnee: false,
        bitsUsage: 'padded16',
        bitsLowPct: 0,
      },
      '/m/a.flac',
    )
    expect(await screen.findByTestId('quality-bits-pill')).toHaveAttribute('data-tone', 'neutral')
    expect(screen.getByTestId('quality-bits-padded')).toHaveAttribute('data-tone', 'neutral')
  })
})

describe('QualitySection analysis failure', () => {
  afterEach(cleanup)

  it('shows a compact error state, not the raw ffmpeg command, when the analysis fails', async () => {
    // ffmpeg dumps its full command and temp paths on failure — useless to a user
    // and already logged in main. The section must show a friendly icon + message,
    // never that wall of text.
    const raw = 'Command failed: /Applications/Surco.app/.../ffmpeg ... Cannot determine format'
    ;(window as unknown as { api: unknown }).api = {
      spectrogram: vi.fn().mockRejectedValue(new Error(raw)),
    }
    const client = createQueryClient()
    render(
      <QueryClientProvider client={client}>
        <QualitySection
          item={track()}
          showSpectrum
          showLoudness={false}
          normalize={OFF}
          open
          onToggle={vi.fn()}
          onShowLoudnessHelp={vi.fn()}
        />
      </QueryClientProvider>,
    )
    const error = await screen.findByTestId('quality-error')
    expect(error).toHaveTextContent(i18n.t('editor.analyzeError'))
    expect(screen.queryByText(raw)).not.toBeInTheDocument()
  })

  // A track moved or renamed in Finder is the everyday case, and "could not analyse the
  // audio" sends the DJ looking for a damaged file instead of a stale path. The main
  // process stamps that failure with a key, which must survive Electron's IPC wrapper.
  it('names a file that is no longer there instead of blaming the audio', async () => {
    const raw =
      "Error invoking remote method 'audio:spectrogram': Error: SURCO_ERR:fileMissing: /Users/dj/Track.flac: No such file or directory"
    ;(window as unknown as { api: unknown }).api = {
      spectrogram: vi.fn().mockRejectedValue(new Error(raw)),
    }
    const client = createQueryClient()
    render(
      <QueryClientProvider client={client}>
        <QualitySection
          item={track()}
          showSpectrum
          showLoudness={false}
          normalize={OFF}
          open
          onToggle={vi.fn()}
          onShowLoudnessHelp={vi.fn()}
        />
      </QueryClientProvider>,
    )

    const error = await screen.findByTestId('quality-error')
    expect(error).toHaveTextContent(i18n.t('errors.fileMissing'))
    expect(error).not.toHaveTextContent(i18n.t('editor.analyzeError'))
  })
})

// The report button is the shareable proof: "is this FLAC fake?" threads live on
// screenshots, so the verdict must leave the app as a single PNG. The composition is
// canvas work (mocked here); what the section owns is showing the action only when
// there is a verdict to share and handing the composed image to the save dialog.
describe('QualitySection shareable report', () => {
  it('saves the composed report through the export dialog', async () => {
    const exportQualityReport = vi.fn().mockResolvedValue('/tmp/report.png')
    renderSection(
      { image: 'data:image/png;base64,x', cutoffHz: 16000, sampleRateHz: 44100, processed: false },
      '/m/a.flac',
    )
    ;(window as unknown as { api: { exportQualityReport: unknown } }).api.exportQualityReport =
      exportQualityReport
    fireEvent.click(await screen.findByTestId('quality-save-report'))
    await waitFor(() => expect(exportQualityReport).toHaveBeenCalled())
    expect(exportQualityReport.mock.calls[0][0]).toBe('data:image/png;base64,report')
    expect(exportQualityReport.mock.calls[0][1]).toContain('a.flac')
  })

  // The shared PNG is the proof users post in "is this fake?" threads, so it must say
  // exactly what the section says, not an older wording the UI no longer stands behind.
  async function saveAndRead(
    spectrum: SpectrumResult,
    path: string,
    showHints = true,
  ): Promise<Record<string, unknown>> {
    reportInputs.length = 0
    renderSection(spectrum, path, showHints)
    ;(window as unknown as { api: { exportQualityReport: unknown } }).api.exportQualityReport = vi
      .fn()
      .mockResolvedValue('/tmp/r.png')
    fireEvent.click(await screen.findByTestId('quality-save-report'))
    await waitFor(() => expect(reportInputs).toHaveLength(1))
    return reportInputs[0]
  }

  it('writes the same evidence line the section shows', async () => {
    const input = await saveAndRead(
      { image: 'x', cutoffHz: 16000, sampleRateHz: 44100, processed: true, humpPeakHz: 19000 },
      '/m/a.flac',
    )
    expect(input.caption).toBe(
      i18n.t('editor.qualityEvidenceHump', { cutoff: '16.0 kHz', peak: '19.0 kHz' }),
    )
  })

  it('writes the full-band chip and the no-cut line for a good file, whatever the hints', async () => {
    const input = await saveAndRead(
      {
        image: 'x',
        cutoffHz: 22050,
        sampleRateHz: 44100,
        processed: false,
        hasKnee: false,
        fineStepDb: 6,
      },
      '/m/a.flac',
      false,
    )
    expect(input.cutoffLabel).toBe('highs ≥ 22 kHz')
    expect(input.caption).toBe(i18n.t('editor.qualityEvidenceGood', { drop: 6 }))
  })

  it('writes the rate and padded-depth findings the section shows', async () => {
    const input = await saveAndRead(
      {
        image: 'x',
        cutoffHz: 21000,
        sampleRateHz: 96000,
        processed: false,
        hasKnee: false,
        resolution: 'hires',
        bitsUsage: 'padded16',
      },
      '/m/a.flac',
    )
    expect(input.notes).toEqual([i18n.t('editor.qualityHiRes'), i18n.t('editor.qualityBitsPadded')])
  })

  it('offers no report while there is no verdict to share', async () => {
    renderSection(
      { image: 'data:image/png;base64,x', cutoffHz: null, sampleRateHz: 44100, processed: false },
      '/m/a.flac',
    )
    expect(await screen.findByTestId('spectrogram')).toBeInTheDocument()
    expect(screen.queryByTestId('quality-save-report')).not.toBeInTheDocument()
  })
})

// The verdict argues itself with the numbers it was decided on — the same
// pedagogy the normalize plan card brought: a "my FLAC is not lossy" dispute
// should arrive with the measured evidence already on screen.
describe('verdict evidence', () => {
  it('argues a transcode with the measured cut, in one short line', async () => {
    renderSection(
      {
        image: '',
        cutoffHz: 16000,
        sampleRateHz: 44100,
        processed: false,
        hasKnee: true,
        fineStepDb: 43.2,
      },
      '/m/a.flac',
    )
    const evidence = await screen.findByTestId('quality-evidence')
    expect(evidence).toHaveTextContent(
      i18n.t('editor.qualityEvidenceTranscode', { cutoff: '16.0 kHz' }),
    )
    expect(
      screen.getAllByText(i18n.t('editor.qualityEvidenceTranscode', { cutoff: '16.0 kHz' })),
    ).toHaveLength(1)
  })

  it('reports a lossy-container cut as normal for the format', async () => {
    renderSection(
      {
        image: '',
        cutoffHz: 16000,
        sampleRateHz: 44100,
        processed: false,
        hasKnee: true,
        fineStepDb: 30.6,
      },
      '/m/a.mp3',
    )
    const evidence = await screen.findByTestId('quality-evidence')
    expect(evidence).toHaveTextContent(
      i18n.t('editor.qualityEvidenceLossy', { cutoff: '16.0 kHz' }),
    )
  })

  // The pill says the file is fine, and the line under it says why: the cut is what the
  // format does. An amber edge beside a green pill read as a warning the DJ had to act on.
  it('frames a lossy-container cut as a neutral fact beside the green pill', async () => {
    renderSection(
      {
        image: '',
        cutoffHz: 16000,
        sampleRateHz: 44100,
        processed: false,
        hasKnee: true,
        fineStepDb: 30.6,
      },
      '/m/a.mp3',
    )
    expect(await screen.findByTestId('quality-evidence')).toHaveAttribute('data-tone', 'neutral')
    expect(screen.getByTestId('quality-badge')).toHaveAttribute('data-tone', 'good')
  })

  it('keeps the measured claim when hints are off', async () => {
    renderSection(
      {
        image: '',
        cutoffHz: 16000,
        sampleRateHz: 44100,
        processed: false,
        hasKnee: true,
        fineStepDb: 43.2,
      },
      '/m/a.flac',
      false,
    )
    const evidence = await screen.findByTestId('quality-evidence')
    expect(evidence).toHaveTextContent(
      i18n.t('editor.qualityEvidenceTranscode', { cutoff: '16.0 kHz' }),
    )
  })

  it('counts the saw-tooth for a Reprocessed verdict: how many rises and where', async () => {
    renderSection(
      {
        image: '',
        cutoffHz: 16500,
        sampleRateHz: 44100,
        processed: true,
        teethCount: 3,
        teethFromHz: 17500,
        teethToHz: 20000,
      },
      '/m/a.flac',
    )
    const evidence = await screen.findByTestId('quality-evidence')
    expect(evidence).toHaveTextContent(
      i18n.t('editor.qualityEvidenceTeeth', { teeth: 3, from: '17.5 kHz', to: '20.0 kHz' }),
    )
  })

  it('names the hump peak over the valley for an enhancer verdict', async () => {
    renderSection(
      {
        image: '',
        cutoffHz: 16000,
        sampleRateHz: 44100,
        processed: true,
        humpPeakHz: 19000,
      },
      '/m/a.flac',
    )
    const evidence = await screen.findByTestId('quality-evidence')
    expect(evidence).toHaveTextContent(
      i18n.t('editor.qualityEvidenceHump', { cutoff: '16.0 kHz', peak: '19.0 kHz' }),
    )
  })

  // The shelf fired on limited club masters and confirmed no reprocessed file, so it is
  // stated as what was seen, in a neutral tone, under a verdict it no longer decides.
  it('states a flat shelf as a neutral, inconclusive observation', async () => {
    renderSection(
      {
        image: '',
        cutoffHz: 22050,
        sampleRateHz: 44100,
        processed: false,
        hasKnee: false,
        flatShelf: true,
      },
      '/m/a.flac',
      false,
    )
    const evidence = await screen.findByTestId('quality-evidence')
    expect(evidence).toHaveTextContent(i18n.t('editor.qualityEvidenceShelf'))
    expect(evidence).toHaveAttribute('data-tone', 'neutral')
    expect(screen.getByTestId('quality-badge')).toHaveTextContent(i18n.t('editor.qualityGood'))
    for (const lng of ['en', 'es']) {
      expect(i18n.getFixedT(lng)('editor.qualityEvidenceShelf')).not.toMatch(/synthetic|sintétic/i)
    }
  })

  it('lets a full-band good verdict earn its badge while hints are on', async () => {
    // The plain good verdict stays caption-free (badge + chip already tell it
    // twice); with hints on and a measured step available, the reassurance line
    // says WHY it is good — the shape, not just the reach.
    renderSection({
      image: '',
      cutoffHz: 21000,
      sampleRateHz: 44100,
      processed: false,
      hasKnee: false,
      fineStepDb: 4.5,
    })
    const evidence = await screen.findByTestId('quality-evidence')
    expect(evidence).toHaveTextContent(i18n.t('editor.qualityEvidenceGood', { drop: 5 }))
  })

  // A knee-free spectrum can still carry a step as steep as a codec wall; saying "no codec
  // cut" beside a codec-sized drop would contradict the number it cites.
  it('drops the no-codec-cut line when the measured step reaches the codec-wall size', async () => {
    renderSection({
      image: '',
      cutoffHz: 21000,
      sampleRateHz: 44100,
      processed: false,
      hasKnee: false,
      fineStepDb: 28,
    })
    await screen.findByTestId('quality-badge')
    expect(screen.queryByTestId('quality-evidence')).not.toBeInTheDocument()
  })

  it('keeps the plain good verdict silent when hints are off', async () => {
    renderSection(
      {
        image: '',
        cutoffHz: 21000,
        sampleRateHz: 44100,
        processed: false,
        hasKnee: false,
        fineStepDb: 4.5,
      },
      '/m/a.flac',
      false,
    )
    await screen.findByTestId('quality-badge')
    expect(screen.queryByTestId('quality-evidence')).not.toBeInTheDocument()
  })

  it('falls back to the old captions when a cached analysis has no evidence', async () => {
    // Analyses cached before the evidence fields existed still deserve a verdict
    // sentence — the un-numbered caption, exactly as before.
    renderSection(
      { image: '', cutoffHz: 16000, sampleRateHz: 44100, processed: false, hasKnee: true },
      '/m/a.flac',
    )
    expect(
      await screen.findByText(i18n.t('editor.qualityCaptionTranscode', { cutoff: '16.0 kHz' })),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('quality-evidence')).not.toBeInTheDocument()
  })

  // The same discipline the captions live under: state the measurement, never
  // guess a bitrate, never coach a listen.
  const EVIDENCE_PARAMS = {
    cutoff: '19.0 kHz',
    drop: 43,
    teeth: 3,
    from: '17.5 kHz',
    to: '20.0 kHz',
    peak: '19.0 kHz',
  }
  it.each([
    'editor.qualityEvidenceGood',
    'editor.qualityEvidenceTranscode',
    'editor.qualityEvidenceLossy',
    'editor.qualityEvidenceTeeth',
    'editor.qualityEvidenceHump',
    'editor.qualityEvidenceShelf',
  ])('keeps %s a measurement: no bitrate guess, no listening advice', (key) => {
    for (const lng of ['en', 'es']) {
      const text = i18n.getFixedT(lng)(key, EVIDENCE_PARAMS)
      expect(text).not.toBe(key)
      expect(text).not.toMatch(/kbps/)
      expect(text).not.toMatch(/listen|escúcha|antes de pinchar|before you play/i)
    }
  })
})

// The bit-depth verdict and the corrected-rate plan, both argued with the
// measurement: the padding reading is the low-byte share of the first minute, and the
// on-convert card says what the policy will do to THIS file before it happens.
describe('bit depth verdict and corrected-rate plan', () => {
  const base = {
    image: '',
    cutoffHz: 21000,
    sampleRateHz: 44100,
    processed: false,
    hasKnee: false,
  }

  // The scan reads only the first minute and allows up to 0.05% of low-byte samples (a
  // fade), so "zero in every sample" was false: the line says what was measured.
  it('flags a padded 16-in-24 container with its pill and the measured reading', async () => {
    renderSection({ ...base, bitsUsage: 'padded16', bitsLowPct: 0 }, '/m/a.flac')
    const note = await screen.findByTestId('quality-bits-padded')
    expect(note).toHaveTextContent(i18n.t('editor.qualityBitsPadded'))
    for (const lng of ['en', 'es']) {
      const t = i18n.getFixedT(lng)
      expect(t('editor.qualityBitsPadded')).not.toMatch(/every sample|todas las muestras/)
      expect(t('editor.qualityBitsPaddedWhy')).toMatch(/first minute|primer minuto/)
    }
    expect(screen.getByTestId('quality-bits-pill')).toHaveTextContent(
      i18n.t('editor.qualityBitsPill'),
    )
    // The didactic why-line rides the hints toggle.
    expect(note).toHaveTextContent(i18n.t('editor.qualityBitsPaddedWhy'))
  })

  it('keeps the padding proof but drops the didactic lines when hints are off', async () => {
    renderSection({ ...base, bitsUsage: 'padded16', bitsLowPct: 0 }, '/m/a.flac', false)
    const note = await screen.findByTestId('quality-bits-padded')
    expect(note).toHaveTextContent(i18n.t('editor.qualityBitsPadded'))
    expect(screen.queryByText(i18n.t('editor.qualityBitsPaddedWhy'))).not.toBeInTheDocument()
  })

  // With inline explanations off the section shows findings only: one line per finding.
  // What converting will do is advice, so it rides the same toggle as the why-line.
  it('states what converting will do only while hints are on', async () => {
    renderSection({ ...base, bitsUsage: 'padded16', bitsLowPct: 0 }, '/m/a.flac', true)
    expect(await screen.findByTestId('quality-bits-padded')).toHaveTextContent(
      i18n.t('editor.qualityBitsPaddedNote'),
    )
    cleanup()
    renderSection({ ...base, bitsUsage: 'padded16', bitsLowPct: 0 }, '/m/a.flac', false)
    expect(await screen.findByTestId('quality-bits-padded')).not.toHaveTextContent(
      i18n.t('editor.qualityBitsPaddedNote'),
    )
  })

  it('lets a real 24-bit file earn its depth while hints are on', async () => {
    renderSection({ ...base, bitsUsage: 'full', bitsLowPct: 99.6 }, '/m/a.flac')
    const note = await screen.findByTestId('quality-bits-full')
    expect(note).toHaveTextContent('99.6%')
  })

  it('keeps the real-24 reassurance quiet when hints are off', async () => {
    renderSection({ ...base, bitsUsage: 'full', bitsLowPct: 99.6 }, '/m/a.flac', false)
    await screen.findByTestId('quality-badge')
    expect(screen.queryByTestId('quality-bits-full')).not.toBeInTheDocument()
  })

  it('says the depth could not be verified instead of staying silent', async () => {
    renderSection({ ...base, bitsUsage: 'unknown' }, '/m/a.flac')
    const note = await screen.findByTestId('quality-bits-unknown')
    expect(note).toHaveTextContent(i18n.t('editor.qualityBitsUnknown'))
  })

  it('keeps the could-not-verify line quiet when hints are off', async () => {
    renderSection({ ...base, bitsUsage: 'unknown' }, '/m/a.flac', false)
    await screen.findByTestId('quality-badge')
    expect(screen.queryByTestId('quality-bits-unknown')).not.toBeInTheDocument()
  })

  it('says nothing about bits when a cached analysis has no verdict', async () => {
    renderSection({ ...base }, '/m/a.flac')
    await screen.findByTestId('quality-badge')
    expect(screen.queryByTestId('quality-bits-padded')).not.toBeInTheDocument()
    expect(screen.queryByTestId('quality-bits-full')).not.toBeInTheDocument()
  })

  it('announces the corrected-rate rewrite on a proven upsample', async () => {
    renderSection(
      { ...base, sampleRateHz: 48000, resolution: 'upsampled' },
      '/m/a.flac',
      true,
      'corrected',
    )
    const plan = await screen.findByTestId('quality-convert-plan')
    expect(plan).toHaveTextContent('48 kHz')
    expect(plan).toHaveTextContent('44.1 kHz')
  })

  it('shows no rewrite card when the policy is off or the verdict clears the file', async () => {
    renderSection(
      { ...base, sampleRateHz: 48000, resolution: 'upsampled' },
      '/m/a.flac',
      true,
      'source',
    )
    await screen.findByTestId('quality-badge')
    expect(screen.queryByTestId('quality-convert-plan')).not.toBeInTheDocument()
    cleanup()
    renderSection(
      { ...base, sampleRateHz: 96000, resolution: 'hires' },
      '/m/a.flac',
      true,
      'corrected',
    )
    await screen.findByTestId('quality-badge')
    expect(screen.queryByTestId('quality-convert-plan')).not.toBeInTheDocument()
  })
})

// The analysis takes seconds and its outcome lands as a pill and an image, neither of
// which a screen reader announces: the user heard nothing start and nothing finish. One
// live region, mounted from the first frame so its changes are actually announced, says
// both.
describe('QualitySection announcements', () => {
  it('announces that the analysis started and then its verdict with the cutoff', async () => {
    renderSection({ image: '', cutoffHz: 16000, sampleRateHz: 44100, processed: false }, '/m/a.m4a')
    const status = screen.getByTestId('quality-status')
    expect(status).toHaveAttribute('role', 'status')
    expect(status).toHaveTextContent(i18n.t('editor.analyzing'))
    await screen.findByTestId('quality-badge')
    expect(screen.getByTestId('quality-status')).toBe(status)
    expect(status).toHaveTextContent(i18n.t('editor.qualityBad'))
    expect(status).toHaveTextContent(i18n.t('editor.spectrumCutoff', { cutoff: '16.0 kHz' }))
  })
})
