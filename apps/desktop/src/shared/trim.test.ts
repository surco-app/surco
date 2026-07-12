import { describe, expect, it } from 'vitest'
import { normalizeTrim, trimFilter } from './trim'

describe('trimFilter', () => {
  it('returns null when there is no trim', () => {
    expect(trimFilter(undefined)).toBeNull()
    expect(trimFilter({})).toBeNull()
  })

  // A zero start cuts nothing — treating it as a trim would force a pointless
  // re-encode on every track whose handles were touched and dragged back.
  it('returns null for a start of zero with no end', () => {
    expect(trimFilter({ startSec: 0 })).toBeNull()
  })

  // atrim leaves the cut audio's original timestamps behind; without resetting
  // them the encoder muxes leading delay into the output.
  it('cuts the head, resets timestamps and fades the cut edge in', () => {
    expect(trimFilter({ startSec: 3.2 })).toBe(
      'atrim=start=3.2,asetpts=PTS-STARTPTS,afade=t=in:d=0.02',
    )
  })

  // The out-fade must sit at the trimmed length, not the source length — after
  // atrim the stream is only (end - start) seconds long.
  it('cuts the tail and fades out at the trimmed end', () => {
    expect(trimFilter({ endSec: 245.8 })).toBe(
      'atrim=end=245.8,asetpts=PTS-STARTPTS,afade=t=out:st=245.78:d=0.02',
    )
  })

  it('cuts both edges with both fades', () => {
    expect(trimFilter({ startSec: 3.2, endSec: 245.8 })).toBe(
      'atrim=start=3.2:end=245.8,asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=242.58:d=0.02',
    )
  })

  // Handle drags produce float noise (0.30000000000000004); the filter string must
  // stay a clean argument, and ffmpeg needs no more than millisecond precision.
  it('rounds seconds to milliseconds', () => {
    expect(trimFilter({ startSec: 0.30000000000000004 })).toBe(
      'atrim=start=0.3,asetpts=PTS-STARTPTS,afade=t=in:d=0.02',
    )
  })
})

describe('normalizeTrim', () => {
  it('passes a valid range through', () => {
    expect(normalizeTrim({ startSec: 3.2, endSec: 245.8 })).toEqual({
      startSec: 3.2,
      endSec: 245.8,
    })
    expect(normalizeTrim({ startSec: 3.2 })).toEqual({ startSec: 3.2 })
    expect(normalizeTrim({ endSec: 245.8 })).toEqual({ endSec: 245.8 })
  })

  // session.json is hand-editable: anything that isn't a usable trim degrades to
  // "no trim" instead of poisoning the conversion filter.
  it('degrades malformed values to undefined', () => {
    expect(normalizeTrim(undefined)).toBeUndefined()
    expect(normalizeTrim('3.2')).toBeUndefined()
    expect(normalizeTrim({})).toBeUndefined()
    expect(normalizeTrim({ startSec: 'x' })).toBeUndefined()
    expect(normalizeTrim({ startSec: Number.NaN })).toBeUndefined()
    expect(normalizeTrim({ startSec: -1 })).toBeUndefined()
    expect(normalizeTrim({ startSec: 0 })).toBeUndefined()
  })

  // An inverted range would make atrim emit an empty stream — the whole track
  // silently vanishing from its own conversion.
  it('rejects an end at or before the start', () => {
    expect(normalizeTrim({ startSec: 10, endSec: 5 })).toBeUndefined()
    expect(normalizeTrim({ startSec: 10, endSec: 10 })).toBeUndefined()
  })

  it('drops an invalid bound but keeps the valid one', () => {
    expect(normalizeTrim({ startSec: 3.2, endSec: 'x' })).toEqual({ startSec: 3.2 })
  })
})
