import { describe, expect, it } from 'vitest'
import { detectOnsets, detectTrim } from './trim'

// 200 buckets over 100 s → 0.5 s per bucket, coarse but plenty for a suggestion
// the user refines with the handles.
function wave(fill: (sec: number) => number): { peaks: number[]; durationSec: number } {
  const peaks = Array.from({ length: 200 }, (_, i) => fill(i * 0.5))
  return { peaks, durationSec: 100 }
}

// Vinyl lead-in/run-out is never digital silence — the fixtures carry surface
// noise well below the -60 dB threshold where the suggestion must still fire.
const NOISE = 0.0005
const MUSIC = 0.3

describe('detectTrim', () => {
  it('suggests cutting a noisy head and tail, padded away from the music', () => {
    const trim = detectTrim(wave((sec) => (sec >= 10 && sec < 90 ? MUSIC : NOISE)))
    // Music starts at bucket 20 (10 s); the suggestion backs off by the pad so
    // the cut never bites the first transient the coarse buckets half-covered.
    expect(trim?.startSec).toBeGreaterThan(8.5)
    expect(trim?.startSec).toBeLessThan(10)
    expect(trim?.endSec).toBeGreaterThan(90)
    expect(trim?.endSec).toBeLessThan(91.5)
  })

  it('suggests only the noisy side', () => {
    const head = detectTrim(wave((sec) => (sec >= 10 ? MUSIC : NOISE)))
    expect(head?.startSec).toBeDefined()
    expect(head?.endSec).toBeUndefined()
    const tail = detectTrim(wave((sec) => (sec < 90 ? MUSIC : NOISE)))
    expect(tail?.startSec).toBeUndefined()
    expect(tail?.endSec).toBeDefined()
  })

  // A suggestion to shave a fraction of a second is noise, not help — the section
  // should read "nothing to trim" for a well-cut track.
  it('suggests nothing when the track starts and ends on music', () => {
    expect(detectTrim(wave(() => MUSIC))).toBeUndefined()
  })

  // All-silent decode (or a null envelope): there is no music to keep, so there is
  // nothing sane to suggest either.
  it('suggests nothing for an all-silent file', () => {
    expect(detectTrim(wave(() => NOISE))).toBeUndefined()
    expect(detectTrim({ peaks: [], durationSec: 0 })).toBeUndefined()
  })
})

describe('detectOnsets', () => {
  // The drag magnet's target: the unpadded edges of the music itself — the exact
  // "at the wave" spot the padded suggestion deliberately backs away from.
  it('returns the unpadded music edges', () => {
    const w = wave((sec) => (sec >= 10 && sec < 90 ? MUSIC : NOISE))
    expect(detectOnsets(w)).toEqual({ startSec: 10, endSec: 90 })
  })

  it('returns undefined for an all-silent decode', () => {
    expect(detectOnsets(wave(() => NOISE))).toBeUndefined()
  })
})
