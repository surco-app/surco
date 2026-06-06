import { describe, expect, it } from 'vitest'
import {
  formatDb,
  formatKHz,
  formatPercent,
  gradeBalance,
  gradeCrest,
  gradeDcOffset,
  gradeLra,
  gradeNoiseFloor,
  gradeLufs,
  gradeTruePeak,
  isLowResCover,
  MIN_COVER_PX,
  qualityVerdict,
} from './quality'

describe('qualityVerdict', () => {
  it('passes a track whose energy reaches near Nyquist as good', () => {
    expect(qualityVerdict(19961, 44100)).toBe('good')
  })

  it('flags a brick-walled cutoff (MP3 hidden in a WAV) as suspect', () => {
    expect(qualityVerdict(15500, 44100)).toBe('suspect')
    expect(qualityVerdict(17000, 44100)).toBe('suspect')
  })

  it('uses the file Nyquist, so the bar scales with sample rate', () => {
    expect(qualityVerdict(21000, 48000)).toBe('good')
    expect(qualityVerdict(19000, 48000)).toBe('suspect')
  })

  it('treats an unknown sample rate as suspect rather than dividing by zero', () => {
    expect(qualityVerdict(20000, 0)).toBe('suspect')
  })
})

describe('formatKHz', () => {
  it('renders hertz as a one-decimal kHz label for the UI', () => {
    expect(formatKHz(19961)).toBe('20.0 kHz')
    expect(formatKHz(16000)).toBe('16.0 kHz')
  })
})

describe('isLowResCover', () => {
  // Discogs usually serves 600px art, but some releases only have a small thumb;
  // the smaller side is what limits how sharp the embedded cover can look.
  it('flags artwork whose smaller side is below the minimum', () => {
    expect(isLowResCover(255, 255)).toBe(true)
    expect(isLowResCover(600, 300)).toBe(true)
  })

  it('passes artwork at or above the minimum on both sides', () => {
    expect(isLowResCover(MIN_COVER_PX, MIN_COVER_PX)).toBe(false)
    expect(isLowResCover(600, 600)).toBe(false)
  })

  // Dimensions aren't known until the image loads; treat 0 as "unknown", not low.
  it('does not flag unknown (zero) dimensions', () => {
    expect(isLowResCover(0, 0)).toBe(false)
  })
})

describe('formatDb', () => {
  it('renders a loudness figure to one decimal for the readout', () => {
    expect(formatDb(-14.73)).toBe('-14.7')
    expect(formatDb(7.6)).toBe('7.6')
  })

  it('shows digital silence (-Infinity) as the minus-infinity glyph instead of "-Infinity"', () => {
    expect(formatDb(-Infinity)).toBe('-∞')
  })
})

// These colour-grade the loudness pills so a non-technical user reads the verdict
// (green/amber/red) without having to understand the numbers — the whole point of
// the readout. The thresholds target a DJ/streaming library, not mastering.
describe('gradeTruePeak', () => {
  it('flags a true peak above 0 dBFS as bad: it clips when re-encoded to a lossy codec or hits the DAC', () => {
    expect(gradeTruePeak(2.5)).toBe('bad')
    expect(gradeTruePeak(0.1)).toBe('bad')
  })

  it('warns inside the last dB of headroom, where inter-sample peaks get risky', () => {
    expect(gradeTruePeak(0)).toBe('warn')
    expect(gradeTruePeak(-0.5)).toBe('warn')
  })

  it('passes a peak with at least 1 dB of headroom as good', () => {
    expect(gradeTruePeak(-1)).toBe('good')
    expect(gradeTruePeak(-6)).toBe('good')
    expect(gradeTruePeak(-Infinity)).toBe('good')
  })
})

describe('gradeLufs', () => {
  it('passes a track sitting in the loud-but-not-crushed band as good', () => {
    expect(gradeLufs(-12)).toBe('good')
    expect(gradeLufs(-16)).toBe('good')
    expect(gradeLufs(-8)).toBe('good')
  })

  it('warns a track that is a touch quiet or a touch hot for a modern library', () => {
    expect(gradeLufs(-18)).toBe('warn')
    expect(gradeLufs(-7)).toBe('warn')
  })

  it('flags the extremes as bad: near-silence (a bad rip) or a crushed master', () => {
    expect(gradeLufs(-70)).toBe('bad')
    expect(gradeLufs(-Infinity)).toBe('bad')
    expect(gradeLufs(-5)).toBe('bad')
  })
})

describe('gradeBalance', () => {
  it('passes a tightly matched pair of channels as good', () => {
    expect(gradeBalance(0.8)).toBe('good')
    expect(gradeBalance(0)).toBe('good')
  })

  it('warns a noticeable left/right imbalance', () => {
    expect(gradeBalance(2)).toBe('warn')
  })

  it('flags a heavy imbalance as bad: one channel clearly weaker than the other', () => {
    expect(gradeBalance(3)).toBe('bad')
    expect(gradeBalance(9)).toBe('bad')
  })
})

describe('gradeDcOffset', () => {
  it('passes a clean, centred signal as good', () => {
    expect(gradeDcOffset(0.00004)).toBe('good')
  })

  it('warns a small but present DC bias', () => {
    expect(gradeDcOffset(0.005)).toBe('warn')
  })

  it('flags a large DC offset as bad: it wastes headroom and adds clicks', () => {
    expect(gradeDcOffset(0.03)).toBe('bad')
  })
})

describe('gradeCrest', () => {
  it('passes a punchy peak-to-RMS spread as good', () => {
    expect(gradeCrest(16)).toBe('good')
    expect(gradeCrest(12)).toBe('good')
  })

  it('warns a track that is getting squashed', () => {
    expect(gradeCrest(10)).toBe('warn')
  })

  it('flags a brick-walled, lifeless crest as bad', () => {
    expect(gradeCrest(6)).toBe('bad')
  })
})

describe('gradeNoiseFloor', () => {
  it('passes a clean, quiet noise floor as good', () => {
    expect(gradeNoiseFloor(-60)).toBe('good')
    expect(gradeNoiseFloor(-45)).toBe('good')
  })

  it('warns an audible noise floor', () => {
    expect(gradeNoiseFloor(-40)).toBe('warn')
  })

  it('flags a loud noise floor as bad: a noisy capture', () => {
    expect(gradeNoiseFloor(-25)).toBe('bad')
  })
})

describe('formatPercent', () => {
  it('renders a 0..1 fraction as a one-decimal percentage for the DC offset pill', () => {
    expect(formatPercent(0.00004)).toBe('0.0%')
    expect(formatPercent(0.032)).toBe('3.2%')
  })
})

describe('gradeLra', () => {
  it('passes a track that keeps real dynamics as good', () => {
    expect(gradeLra(7)).toBe('good')
    expect(gradeLra(6)).toBe('good')
  })

  it('warns a moderately compressed track', () => {
    expect(gradeLra(4)).toBe('warn')
  })

  it('flags a flat, brick-walled range as bad (the loudness-war signature)', () => {
    expect(gradeLra(0)).toBe('bad')
    expect(gradeLra(2)).toBe('bad')
  })
})
