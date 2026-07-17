import { describe, expect, it } from 'vitest'
import type { NormalizeConfig } from '../../../shared/types'
import type { TrackItem, TrackStatus } from '../types'
import { isDeclickStale, isNormalizeStale, isStale, trackSignature } from './dirty'

// A freshly converted track: its snapshot equals its own current values, so it is
// non-stale by construction. Tests then spread an edit on top to diverge from it.
function converted(overrides: Partial<TrackItem> = {}): TrackItem {
  const base: TrackItem = {
    id: 'a',
    inputPath: '/a.aiff',
    fileName: 'a',
    listLabel: 'Still Can’t',
    query: '',
    status: 'done',
    outputPath: '/out/a.aiff',
    meta: {
      title: 'Still Can’t',
      artist: 'DJ Carlos',
      album: '',
      albumArtist: '',
      year: '',
      genre: '',
      grouping: '',
      comment: '',
      trackNumber: '',
      discNumber: '',
      bpm: '',
      key: '',
      publisher: '',
      catalogNumber: '',
      remixArtist: '',
    },
    ...overrides,
  }
  return { ...base, processedSignature: trackSignature(base) }
}

describe('isStale', () => {
  it('is false right after conversion, when the editor still matches the file', () => {
    expect(isStale(converted())).toBe(false)
  })

  it('is true once a metadata field is edited after conversion', () => {
    const t = converted()
    expect(isStale({ ...t, meta: { ...t.meta, title: 'Still Can’t (Extended Mix)' } })).toBe(true)
  })

  it('is true when the output name changes', () => {
    expect(isStale({ ...converted(), outputName: 'renamed' })).toBe(true)
  })

  it('is true when the cover changes', () => {
    expect(isStale({ ...converted(), coverUrl: 'https://example.com/new.jpg' })).toBe(true)
  })

  // Swapping one embedded (base64 data URL) cover for another must still read as stale —
  // the change-detecting proxy has to distinguish them without carrying the payload.
  it('is true when an embedded base64 cover is swapped for a different one', () => {
    const t = converted({ coverUrl: `data:image/jpeg;base64,${'A'.repeat(50000)}` })
    expect(isStale({ ...t, coverUrl: `data:image/jpeg;base64,${'B'.repeat(50000)}` })).toBe(true)
  })

  // The whole point of Finding 4: the signature must NOT embed the ~40–110 KB base64
  // cover, or every staleness check and session save stringifies it per track (tens of MB
  // across a crate). A proxy keeps the signature small while still detecting change.
  it('keeps the signature small instead of embedding the base64 cover', () => {
    const big = `data:image/jpeg;base64,${'A'.repeat(80000)}`
    expect(trackSignature({ ...converted(), coverUrl: big }).length).toBeLessThan(1000)
  })

  // The trim lives on the track (unlike the declick/normalize dials), so it rides the
  // signature: dragging a handle after an export must bring the Update button back —
  // and, through the same signature in hasStagedEdits, get the edit into session.json.
  it('is true when the silence trim changes after conversion', () => {
    expect(isStale({ ...converted(), trim: { startSec: 1.2 } })).toBe(true)
  })

  it('is never stale before a track is done, since those states already show a convert button', () => {
    for (const status of ['idle', 'processing', 'error'] as TrackStatus[]) {
      expect(isStale(converted({ status }))).toBe(false)
    }
  })

  it('treats a done track with no snapshot as fresh rather than stale', () => {
    expect(isStale({ ...converted(), processedSignature: undefined })).toBe(false)
  })
})

const cfg = (over: Partial<NormalizeConfig> = {}): NormalizeConfig => ({
  mode: 'none',
  targetLufs: -14,
  truePeakDb: -1,
  peakDb: -1,
  ...over,
})

// Djotas's re-normalize flow: after exporting at one loudness, dialing in another
// value must bring the Update button back — without it, applying a new target means
// pretending to edit a tag or reloading the file.
describe('isNormalizeStale', () => {
  it('is false right after conversion, when the dial still matches the file', () => {
    const applied = cfg({ mode: 'loudness', targetLufs: -14 })
    const t = converted({ processedNormalize: applied })
    expect(isNormalizeStale(t, applied)).toBe(false)
  })

  it('is true once the loudness target changes after conversion', () => {
    const t = converted({ processedNormalize: cfg({ mode: 'loudness', targetLufs: -14 }) })
    expect(isNormalizeStale(t, cfg({ mode: 'loudness', targetLufs: -9 }))).toBe(true)
  })

  it('is true when the mode changes after conversion', () => {
    const t = converted({ processedNormalize: cfg() })
    expect(isNormalizeStale(t, cfg({ mode: 'loudness' }))).toBe(true)
  })

  it('ignores the numbers of a mode that is not active', () => {
    const t = converted({ processedNormalize: cfg({ peakDb: -1 }) })
    expect(isNormalizeStale(t, cfg({ peakDb: -0.1 }))).toBe(false)
  })

  it('is true when a peak option (DC removal, independent channels) is toggled', () => {
    const t = converted({ processedNormalize: cfg({ mode: 'peak' }) })
    expect(isNormalizeStale(t, cfg({ mode: 'peak', peakRemoveDc: true }))).toBe(true)
    expect(isNormalizeStale(t, cfg({ mode: 'peak', peakPerChannel: true }))).toBe(true)
  })

  it('treats a missing peak option as off, so old exports do not read as stale', () => {
    const t = converted({ processedNormalize: cfg({ mode: 'peak' }) })
    expect(isNormalizeStale(t, cfg({ mode: 'peak', peakRemoveDc: false }))).toBe(false)
  })

  it('is never stale before a track is done', () => {
    const t = converted({ status: 'idle', processedNormalize: cfg() })
    expect(isNormalizeStale(t, cfg({ mode: 'peak' }))).toBe(false)
  })

  it('treats a track converted before the config was recorded as fresh', () => {
    expect(isNormalizeStale(converted(), cfg({ mode: 'loudness' }))).toBe(false)
  })
})

// Same flow for click repair: switching the intensity after an export must bring
// the Update button back, without pretending to edit a tag first.
describe('isDeclickStale', () => {
  it('is false right after conversion, when the pick still matches the file', () => {
    expect(isDeclickStale(converted({ processedDeclick: 'standard' }), 'standard')).toBe(false)
  })

  it('is true once the intensity changes after conversion', () => {
    expect(isDeclickStale(converted({ processedDeclick: 'off' }), 'standard')).toBe(true)
    expect(isDeclickStale(converted({ processedDeclick: 'standard' }), 'soft')).toBe(true)
  })

  it('is never stale before a track is done', () => {
    const t = converted({ status: 'idle', processedDeclick: 'off' })
    expect(isDeclickStale(t, 'strong')).toBe(false)
  })

  it('treats a track converted before the mode was recorded as fresh', () => {
    expect(isDeclickStale(converted(), 'strong')).toBe(false)
  })
})
