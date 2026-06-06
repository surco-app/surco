import { describe, expect, it } from 'vitest'
import type { NormalizeConfig } from '../shared/types'
import {
  loudnormArgs,
  loudnormFilter,
  parseLoudnorm,
  parseMaxVolume,
  peakGainDb,
  volumeFilter,
} from './normalize'

const loudness: NormalizeConfig = { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

describe('parseLoudnorm', () => {
  // loudnorm's first pass prints a JSON block to stderr, prefixed by the filter
  // tag. We need the measured input_* values and the target_offset to feed the
  // accurate (linear) second pass.
  const out = `[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-14.58",\n\t"input_tp" : "-0.16",\n\t"input_lra" : "6.60",\n\t"input_thresh" : "-24.79",\n\t"output_i" : "-13.93",\n\t"target_offset" : "-0.07"\n}`

  it('reads the measured input figures and target offset from the JSON block', () => {
    expect(parseLoudnorm(out)).toEqual({
      inputI: -14.58,
      inputTp: -0.16,
      inputLra: 6.6,
      inputThresh: -24.79,
      targetOffset: -0.07,
    })
  })

  it('returns null when no JSON is present (the measurement pass failed)', () => {
    expect(parseLoudnorm('ffmpeg error, no json here')).toBeNull()
  })

  it('returns null when a figure is non-finite (e.g. -inf on silence) so we skip rather than feed garbage', () => {
    const silent = out.replace('"input_i" : "-14.58"', '"input_i" : "-inf"')
    expect(parseLoudnorm(silent)).toBeNull()
  })
})

describe('loudnormFilter', () => {
  it('builds the accurate second pass from the target plus the measured values', () => {
    const f = loudnormFilter(loudness, {
      inputI: -14.58,
      inputTp: -0.16,
      inputLra: 6.6,
      inputThresh: -24.79,
      targetOffset: -0.07,
    })
    expect(f).toContain('loudnorm=I=-14:TP=-1:LRA=11')
    expect(f).toContain('measured_I=-14.58')
    expect(f).toContain('measured_TP=-0.16')
    expect(f).toContain('measured_thresh=-24.79')
    expect(f).toContain('offset=-0.07')
    // linear=true keeps the dynamics intact instead of pumping per-frame.
    expect(f).toContain('linear=true')
  })

  // loudnorm oversamples to 192 kHz internally and emits its output at that rate;
  // without restoring the source rate every normalized file would balloon to
  // 192 kHz and silently change sample rate — wrong for a 44.1 kHz rip.
  it('restores the source sample rate after loudnorm', () => {
    const m = {
      inputI: -14.58,
      inputTp: -0.16,
      inputLra: 6.6,
      inputThresh: -24.79,
      targetOffset: -0.07,
    }
    expect(loudnormFilter(loudness, m, 44100)).toMatch(/loudnorm=.*linear=true,aresample=44100$/)
    // No rate known → no resampler appended, rather than guessing.
    expect(loudnormFilter(loudness, m)).not.toContain('aresample')
  })
})

describe('loudnormArgs', () => {
  it('runs a measurement-only pass: the chosen target with json output to a null sink', () => {
    const args = loudnormArgs('/in.aiff', loudness)
    expect(args).toContain('/in.aiff')
    expect(args.join(' ')).toContain('loudnorm=I=-14:TP=-1:LRA=11:print_format=json')
    // measurement only: decode to a null muxer, no file written
    expect(args.slice(-3)).toEqual(['-f', 'null', '-'])
  })
})

describe('parseMaxVolume', () => {
  it('reads the peak sample level volumedetect reports', () => {
    expect(parseMaxVolume('[Parsed_volumedetect_0 @ 0x1] max_volume: -0.2 dB')).toBe(-0.2)
  })

  it('returns null when volumedetect printed nothing usable', () => {
    expect(parseMaxVolume('no volume here')).toBeNull()
  })
})

describe('peakGainDb', () => {
  it('computes the gain that lifts the loudest sample to the target ceiling', () => {
    // a track peaking at -6 dB, target -1 dB → boost +5 dB
    expect(peakGainDb(-1, -6)).toBe(5)
  })

  it('attenuates when the track already peaks above the target', () => {
    // peaking at +2 dB (clipping), target -1 → cut 3 dB
    expect(peakGainDb(-1, 2)).toBe(-3)
  })
})

describe('volumeFilter', () => {
  it('renders the gain as an ffmpeg volume filter in dB', () => {
    expect(volumeFilter(5)).toBe('volume=5dB')
    expect(volumeFilter(-3.2)).toBe('volume=-3.2dB')
  })
})
