import { describe, expect, it } from 'vitest'
import { declickRepairedArgs, parseDeclickedSamples, parseProgressSeconds } from './declick'

// declickFilter itself (modes, sensitivity mapping, safety clamps) is covered in
// shared/declick.test.ts — it moved to shared so the renderer can show the exact
// applied filter string.

describe('declickRepairedArgs', () => {
  it('renders the repaired track itself — what the user will actually hear', () => {
    const args = declickRepairedArgs('/in.wav', '/out.wav', 'strong')
    expect(args?.join(' ')).toContain('-af adeclick=b=4')
    // No phase-inversion filtergraph: the old audition rendered the *removed* clicks,
    // and a preview that still did that would answer the wrong question.
    expect(args?.join(' ')).not.toContain('volume=-1')
    expect(args?.join(' ')).not.toContain('amix')
    expect(args?.slice(-2)).toEqual(['pcm_s16le', '/out.wav'])
  })

  it('renders the whole track, never an excerpt', () => {
    // The clicks sit wherever the stylus hit dust, and the marks invite a jump to any
    // of them — a windowed render would have nothing to play at most of them.
    const args = declickRepairedArgs('/in.wav', '/out.wav', 'standard')
    expect(args).not.toContain('-ss')
    expect(args).not.toContain('-t')
  })

  it('asks ffmpeg for machine-readable progress, since the render is slow', () => {
    expect(declickRepairedArgs('/in.wav', '/out.wav', 'standard')?.join(' ')).toContain(
      '-progress pipe:1',
    )
  })

  it('has nothing to render when the repair is off', () => {
    expect(declickRepairedArgs('/in.wav', '/out.wav', 'off')).toBeNull()
  })
})

describe('parseProgressSeconds', () => {
  it('reads the latest position, not the first', () => {
    expect(
      parseProgressSeconds('out_time_us=1000000\nprogress=continue\nout_time_us=4500000\n'),
    ).toBe(4.5)
  })

  it('says nothing until ffmpeg has reported a position', () => {
    expect(parseProgressSeconds('progress=continue\n')).toBeNull()
  })
})

describe('parseDeclickedSamples', () => {
  it('reads the repaired-sample count adeclick prints at stream end', () => {
    const stderr = [
      'size=     861kB time=00:00:09.99 bitrate= 706.4kbits/s speed= 121x',
      '[Parsed_adeclick_0 @ 0x600003084580] Detected clicks in 234 of 441000 samples (0.0530612%).',
    ].join('\n')
    expect(parseDeclickedSamples(stderr)).toBe(234)
  })

  it('sums the counts when the filter reports more than one line', () => {
    const stderr = [
      '[Parsed_adeclick_0 @ 0x1] Detected clicks in 100 of 441000 samples (0.02%).',
      '[Parsed_adeclick_0 @ 0x1] Detected clicks in 34 of 441000 samples (0.007%).',
    ].join('\n')
    expect(parseDeclickedSamples(stderr)).toBe(134)
  })

  it('returns null when the encode ran without the filter, so 0 repaired and not-run stay distinct', () => {
    expect(parseDeclickedSamples('size= 861kB time=00:00:09.99')).toBeNull()
  })

  it('reads a clean run as zero, not as missing', () => {
    expect(
      parseDeclickedSamples(
        '[Parsed_adeclick_0 @ 0x1] Detected clicks in 0 of 441000 samples (0%).',
      ),
    ).toBe(0)
  })
})
