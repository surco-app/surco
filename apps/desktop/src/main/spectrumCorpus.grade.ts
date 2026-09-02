import {
  type Band,
  bandFrequencies,
  detectCutoff,
  fineBandFrequencies,
  fineBandsShowWall,
  steepestFineStep,
} from './cutoff'
import { buildSpectrum } from './ffmpeg'
import {
  detectFftKnee,
  detectFlatShelf,
  BAND_START_HZ as SHELF_START_HZ,
  BAND_WIDTH_HZ as SHELF_WIDTH_HZ,
} from './hfShelf'
import type { CorpusEntry } from './spectrumCorpus.fixture'

export const NYQUIST = 22050

export type MeasuredBands = Pick<CorpusEntry, 'name' | 'coarse' | 'fine' | 'shelf'>

const toBands = (freqs: number[], rms: number[]): Band[] =>
  freqs.map((freqHz, i) => ({ freqHz, rmsDb: rms[i] }))

// The same wiring audioIpc.ts gives buildSpectrum, minus the decodes: every pure
// detector runs on recorded bands, so a verdict here is the verdict the app shows.
// Shared by the corpus suite and the invariance suite so both grade one way.
export async function gradeEntry(
  entry: MeasuredBands,
): Promise<Awaited<ReturnType<typeof buildSpectrum>>> {
  const coarse = toBands(bandFrequencies(NYQUIST), entry.coarse)
  const fine = toBands(fineBandFrequencies(NYQUIST), entry.fine)
  return buildSpectrum(entry.name, {
    probe: async () => ({ sampleRate: '44100' }),
    spectrogram: async () => '',
    cutoff: async () => ({
      ...detectCutoff(coarse, NYQUIST, fine),
      upsampled: false,
      fineWall: fineBandsShowWall(fine),
      fineStepDb: steepestFineStep(fine),
    }),
    shelf: async () => ({
      shelfCutoffHz: detectFlatShelf(entry.shelf, SHELF_START_HZ, SHELF_WIDTH_HZ, NYQUIST),
      kneeCutoffHz: detectFftKnee(entry.shelf, SHELF_START_HZ, SHELF_WIDTH_HZ),
    }),
  })
}
