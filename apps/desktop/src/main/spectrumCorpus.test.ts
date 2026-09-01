import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import {
  type Band,
  bandFrequencies,
  detectCutoff,
  fineBandFrequencies,
  fineBandsShowWall,
} from './cutoff'
import { buildSpectrum } from './ffmpeg'
import {
  BAND_START_HZ as SHELF_START_HZ,
  BAND_WIDTH_HZ as SHELF_WIDTH_HZ,
  detectFftKnee,
  detectFlatShelf,
} from './hfShelf'
import { type CorpusEntry, SPECTRUM_CORPUS } from './spectrumCorpus.fixture'

const NYQUIST = 22050

const toBands = (freqs: number[], rms: number[]): Band[] =>
  freqs.map((freqHz, i) => ({ freqHz, rmsDb: rms[i] }))

// The same wiring audioIpc.ts gives buildSpectrum, minus the decodes: every pure
// detector runs on the recorded bands, so a verdict here is the verdict the app shows.
async function grade(entry: CorpusEntry) {
  const coarse = toBands(bandFrequencies(NYQUIST), entry.coarse)
  const fine = toBands(fineBandFrequencies(NYQUIST), entry.fine)
  return buildSpectrum(entry.name, {
    probe: async () => ({ sampleRate: '44100' }),
    spectrogram: async () => '',
    cutoff: async () => ({
      ...detectCutoff(coarse, NYQUIST, fine),
      upsampled: false,
      fineWall: fineBandsShowWall(fine),
    }),
    shelf: async () => ({
      shelfCutoffHz: detectFlatShelf(entry.shelf, SHELF_START_HZ, SHELF_WIDTH_HZ, NYQUIST),
      kneeCutoffHz: detectFftKnee(entry.shelf, SHELF_START_HZ, SHELF_WIDTH_HZ),
    }),
  })
}

const byKind = (kind: CorpusEntry['kind']) => SPECTRUM_CORPUS.filter((e) => e.kind === kind)

describe('spectrum verdicts over the measured corpus', () => {
  it('covers every population the thresholds were calibrated on', () => {
    expect(byKind('encode')).toHaveLength(36)
    expect(byKind('lossless')).toHaveLength(9)
    expect(byKind('clean')).toHaveLength(6)
  })

  it.each(byKind('encode').map((e) => [e.name, e] as const))(
    'catches the codec lowpass in %s',
    async (_name, entry) => {
      // Each of these is a real LAME encode of one of the lossless rows: the wall is
      // there by construction, and a miss means a fake lossless would sail through.
      const verdict = await grade(entry)
      expect(verdict.hasKnee).toBe(true)
      expect(verdict.processed).toBe(false)
    },
  )

  it.each(byKind('lossless').map((e) => [e.name, e] as const))(
    'leaves the lossless source %s unflagged',
    async (_name, entry) => {
      // The very file its encodes were made from. Any knee or "processed" here is a
      // false accusation against a genuine master.
      const verdict = await grade(entry)
      expect(verdict.hasKnee).toBe(false)
      expect(verdict.processed).toBe(false)
    },
  )

  it.each(byKind('clean').map((e) => [e.name, e] as const))(
    'leaves the user-reported clean rip %s unflagged',
    async (_name, entry) => {
      // Real files users sent in after being told they were lossy or reprocessed:
      // three CD rips of one quiet album whose dithery top end read as a wall, and a
      // loud tech-house master whose mastering rolloff read as a codec cut. Each was
      // a shipped false positive; none may come back.
      const verdict = await grade(entry)
      expect(verdict.hasKnee).toBe(false)
      expect(verdict.processed).toBe(false)
    },
  )

  it('places each encoder lowpass within a band of its known setting', async () => {
    // LAME's lowpass by bitrate: 128k ~16-17 kHz, 192k ~18-19 kHz, 256k ~19-20 kHz,
    // 320k ~20 kHz. The reported cutoff must land on that shelf, not merely flag it.
    const expected: Record<string, [number, number]> = {
      _128: [16000, 17000],
      _192: [17000, 19000],
      _256: [19000, 20000],
      _320: [19000, 20000],
    }
    for (const entry of byKind('encode')) {
      const suffix = entry.name.slice(entry.name.lastIndexOf('_'))
      const [lo, hi] = expected[suffix]
      const { cutoffHz } = await grade(entry)
      expect(cutoffHz, entry.name).toBeGreaterThanOrEqual(lo)
      expect(cutoffHz, entry.name).toBeLessThanOrEqual(hi)
    }
  })
})
