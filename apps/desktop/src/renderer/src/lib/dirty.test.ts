import { describe, expect, it } from 'vitest'
import type { TrackItem, TrackStatus } from '../types'
import { isStale, trackSignature } from './dirty'

// A freshly converted track: its snapshot equals its own current values, so it is
// non-stale by construction. Tests then spread an edit on top to diverge from it.
function converted(overrides: Partial<TrackItem> = {}): TrackItem {
  const base: TrackItem = {
    id: 'a',
    inputPath: '/a.aiff',
    fileName: 'a',
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

  it('is never stale before a track is done, since those states already show a convert button', () => {
    for (const status of ['idle', 'processing', 'error'] as TrackStatus[]) {
      expect(isStale(converted({ status }))).toBe(false)
    }
  })

  it('treats a done track with no snapshot as fresh rather than stale', () => {
    expect(isStale({ ...converted(), processedSignature: undefined })).toBe(false)
  })
})
