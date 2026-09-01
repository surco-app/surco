import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { SPECTRUM_CORPUS } from './spectrumCorpus.fixture'
import { gradeEntry, type MeasuredBands } from './spectrumCorpus.grade'

// Four user reports in three days had one anatomy: a threshold calibrated on the
// corpus, crossed by a real master the corpus never saw. The last one was literally
// "same spectrum, 8 dB louder, opposite verdict". These suites turn that into a rule:
// a verdict is a claim about the SHAPE of a spectrum, so it must survive the
// transformations that leave the shape alone. Both are exact at band level, no audio
// needed: a linear gain shifts every band by the same dB, and an independent noise
// floor adds to each band in power.

// Whole-mix gain, the difference between a quiet reissue and a loud remaster.
const GAINS_DB = [-20, -10, 10, 20]

// A flat noise floor. The band RMS is normalised per hertz, so a flat floor reads the
// same on the 1 kHz and 500 Hz grids: 16-bit TPDF dither measures -126 dB on both,
// straight off a real transfer through the app's own decode. The stress floors for
// clean masters go well past that; the encode floor is the measured one.
const FLOORS_DB = [-120, -110, -100]
const DITHER_16BIT_FLOOR_DB = -126

const powerAdd = (aDb: number, bDb: number): number =>
  10 * Math.log10(10 ** (aDb / 10) + 10 ** (bDb / 10))

function shifted(entry: MeasuredBands, gainDb: number): MeasuredBands {
  const up = (xs: number[]): number[] => xs.map((x) => x + gainDb)
  return { ...entry, coarse: up(entry.coarse), fine: up(entry.fine), shelf: up(entry.shelf) }
}

// The shelf grid is un-normalized summed power, so its floor rides on the offset
// between it and the coarse bands, which share its 1 kHz spacing (shelf band k+1 is
// coarse band k).
function withFloor(entry: MeasuredBands, floorDb: number): MeasuredBands {
  const pairs = entry.coarse
    .map((c, k) => [c, entry.shelf[k + 1]] as const)
    .filter(([c, s]) => Number.isFinite(c) && Number.isFinite(s))
  const offset = pairs.reduce((sum, [c, s]) => sum + (s - c), 0) / pairs.length
  return {
    ...entry,
    coarse: entry.coarse.map((x) => powerAdd(x, floorDb)),
    fine: entry.fine.map((x) => powerAdd(x, floorDb)),
    shelf: entry.shelf.map((x) => powerAdd(x, floorDb + offset)),
  }
}

const verdictOf = async (entry: MeasuredBands) => {
  const v = await gradeEntry(entry)
  return { hasKnee: v.hasKnee, processed: v.processed }
}

const sign = (db: number): string => `${db > 0 ? '+' : ''}${db} dB`

describe('spectrum verdicts are invariant to whole-mix gain', () => {
  for (const entry of SPECTRUM_CORPUS) {
    for (const gainDb of GAINS_DB) {
      it(`${entry.name} at ${sign(gainDb)}`, async () => {
        expect(await verdictOf(shifted(entry, gainDb))).toEqual(await verdictOf(entry))
      })
    }
  }
})

// Adding a floor must never manufacture an accusation: a clean rip stays clean
// whatever it was dithered or transferred through.
describe('a noise floor never flags a clean spectrum', () => {
  for (const entry of SPECTRUM_CORPUS.filter((e) => e.kind !== 'encode')) {
    for (const floorDb of FLOORS_DB) {
      it(`${entry.name} over a ${floorDb} dB floor`, async () => {
        expect(await verdictOf(withFloor(entry, floorDb))).toEqual(await verdictOf(entry))
      })
    }
  }
})

// The other direction is where this suite earned its keep. The codec wall is
// recognised by a monotone fine-band fall, first calibrated at 45 dB on LAME output
// decoded in float, where the stopband sits at -150 dB. Burn the same encodes to
// 16-bit, the "lossy source on a CD" this badge exists for, and dither puts the
// floor at -126: a 320 falls 42.7 dB and a 256 43.4, both graded "Good quality"
// (measured on real files, now in the corpus as the -cd16 entries). A real transfer
// is the floor an encode has to be caught through, so every encode must survive it.
// A floor 20 dB higher hides a wall behind hiss for real; there is no rule for that.
describe('a noise floor at real dither level never hides a codec wall', () => {
  for (const entry of SPECTRUM_CORPUS.filter((e) => e.kind === 'encode')) {
    it(`${entry.name} over a ${DITHER_16BIT_FLOOR_DB} dB floor`, async () => {
      expect(await verdictOf(withFloor(entry, DITHER_16BIT_FLOOR_DB))).toEqual(
        await verdictOf(entry),
      )
    })
  }
})
