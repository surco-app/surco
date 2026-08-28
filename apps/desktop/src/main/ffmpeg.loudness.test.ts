import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

// Each ffmpeg invocation, with the moment it started and finished, so the test can
// tell a chained graph from two passes that genuinely overlap.
const calls: Array<{ args: string[]; start: number; end: number }> = []
let clock = 0

vi.mock('node:child_process', () => ({
  execFile: (
    _file: string,
    args: string[],
    _opts: unknown,
    cb: (err: unknown, out: { stdout: string; stderr: string }) => void,
  ) => {
    const start = clock++
    const filter = args.join(' ')
    // Answer each pass with only the summary its own filter would print, so a
    // parser reading a value from the wrong pass surfaces as a null.
    const stderr = filter.includes('ebur128')
      ? [
          '[Parsed_ebur128_0 @ 0x1] Summary:',
          '',
          '  Integrated loudness:',
          '    I:          -8.1 LUFS',
          '  Loudness range:',
          '    LRA:         7.1 LU',
          '  True peak:',
          '    Peak:       -0.2 dBFS',
        ].join('\n')
      : [
          '[Parsed_astats_0 @ 0x1] Overall',
          '[Parsed_astats_0 @ 0x1] DC offset: 0.000100',
          '[Parsed_astats_0 @ 0x1] Peak level dB: -0.210072',
          '[Parsed_astats_0 @ 0x1] RMS level dB: -10.587320',
          '[Parsed_astats_0 @ 0x1] Noise floor dB: -60.100000',
        ].join('\n')
    // Resolve on a later tick so both passes are in flight at once when started
    // together — a sequential implementation cannot produce overlapping windows.
    setTimeout(() => {
      calls.push({ args, start, end: clock++ })
      cb(null, { stdout: '', stderr })
    }, 0)
  },
}))

import { measureLoudness } from './ffmpeg'

describe('measureLoudness', () => {
  it('runs the true-peak and stats passes concurrently instead of chaining them', async () => {
    // ebur128's true-peak mode costs about six times the rest of the measurement
    // (1.20s vs 0.20s measured), and chaining it after astats serialises the two:
    // one graph took 1.94s where two overlapping passes take 1.28s. They share no
    // state, so nothing forces them to run in sequence.
    calls.length = 0
    clock = 0
    await measureLoudness('/in.wav')

    expect(calls).toHaveLength(2)
    const [a, b] = calls
    const overlaps = a.start < b.end && b.start < a.end
    expect(overlaps, 'the two passes ran one after the other').toBe(true)
  })

  it('asks each pass for only its own filter, so neither pays for the other', async () => {
    calls.length = 0
    clock = 0
    await measureLoudness('/in.wav')

    const filters = calls.map((c) => c.args.join(' '))
    const peak = filters.find((f) => f.includes('ebur128')) as string
    const stats = filters.find((f) => f.includes('astats')) as string
    // The whole point: the expensive true-peak analysis must not also drag astats
    // through its graph, nor astats drag ebur128 through its own.
    expect(peak).not.toContain('astats')
    expect(stats).not.toContain('ebur128')
  })

  it('still reports every figure the editor reads, from whichever pass measured it', async () => {
    // Splitting the graph must not lose a value: the loudness trio comes from one
    // pass and the stats from the other, and the caller sees a single result.
    calls.length = 0
    clock = 0
    const result = await measureLoudness('/in.wav')

    expect(result).toEqual({
      integratedLufs: -8.1,
      truePeakDb: -0.2,
      lra: 7.1,
      channelBalanceDb: null,
      dcOffset: 0.0001,
      // Derived from the astats pass as peak − RMS, not read off its "Crest factor"
      // line: −0.210072 − (−10.587320).
      crestDb: 10.377248,
      noiseFloorDb: -60.1,
    })
  })
})
