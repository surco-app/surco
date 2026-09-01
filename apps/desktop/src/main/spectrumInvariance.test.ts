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

// A flat noise floor, per 1 kHz band: -110 is what 16-bit dither leaves when spread
// over a kilohertz, -100 a noisy transfer, -120 a clean 24-bit master.
const FLOORS_DB = [-120, -110, -100]

const powerAdd = (aDb: number, bDb: number): number =>
  10 * Math.log10(10 ** (aDb / 10) + 10 ** (bDb / 10))

function shifted(entry: MeasuredBands, gainDb: number): MeasuredBands {
  const up = (xs: number[]): number[] => xs.map((x) => x + gainDb)
  return { ...entry, coarse: up(entry.coarse), fine: up(entry.fine), shelf: up(entry.shelf) }
}

// The shelf grid is un-normalized summed power, so its floor rides on the offset
// between it and the coarse bands, which share its 1 kHz spacing (shelf band k+1 is
// coarse band k). A 500 Hz fine band holds half the power of a 1 kHz one: 3 dB less.
function withFloor(entry: MeasuredBands, floorDb: number): MeasuredBands {
  const pairs = entry.coarse
    .map((c, k) => [c, entry.shelf[k + 1]] as const)
    .filter(([c, s]) => Number.isFinite(c) && Number.isFinite(s))
  const offset = pairs.reduce((sum, [c, s]) => sum + (s - c), 0) / pairs.length
  return {
    ...entry,
    coarse: entry.coarse.map((x) => powerAdd(x, floorDb)),
    fine: entry.fine.map((x) => powerAdd(x, floorDb - 3)),
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

// The other direction is where the detector currently falls short, and this suite
// is what found it. The codec wall is recognised by a monotone fine-band fall of at
// least 45 dB, calibrated on LAME output decoded in float, where the stopband sits
// at -150 dB. Give the same encodes the floor a real transfer leaves and the fall is
// cut to content-minus-floor: over -110 dB (16-bit dither, the "lossy source burned
// to CD" this badge exists for) 12 of 36 encodes go unflagged, over -100 dB 34 of 36,
// while the deepest genuine fall in the corpus is 32 dB. Measured on the corpus, a
// fall across one kilohertz of fine bands separates instead: encodes ≥29 dB under a
// -110 floor and ≥51 raw, clean masters ≤22 in every condition. Recalibrating the
// wall is a verdict change with a release behind it, so these stay on record as
// pending rather than asserted; under -100 dB nothing separates, which is physics.
describe('a noise floor should not hide a codec wall', () => {
  for (const entry of SPECTRUM_CORPUS.filter((e) => e.kind === 'encode')) {
    for (const floorDb of [-120, -110]) {
      it.todo(`${entry.name} over a ${floorDb} dB floor`)
    }
  }
})
