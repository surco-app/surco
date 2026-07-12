import { describe, expect, it } from 'vitest'
import { declickFilter, parseDeclickedSamples } from './declick'

describe('declickFilter', () => {
  it('returns no filter when off, so a plain conversion stays untouched', () => {
    expect(declickFilter('off')).toBeNull()
  })

  it('uses adeclick defaults for standard clicks', () => {
    expect(declickFilter('standard')).toBe('adeclick')
  })

  it('uses the minimal burst fusion that repairs long pops in strong mode', () => {
    // Burst fusion is the one knob that repairs long pops, and its cost explodes on
    // dense music (b=10 never finished 10 s of a club track; b=6 ran slower than
    // realtime). b=4 is the lowest value that still repairs them (b=3 does not) and
    // stays bounded, so anything above it is a hang report waiting to happen.
    expect(declickFilter('strong')).toBe('adeclick=b=4')
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
      parseDeclickedSamples('[Parsed_adeclick_0 @ 0x1] Detected clicks in 0 of 441000 samples (0%).'),
    ).toBe(0)
  })
})
