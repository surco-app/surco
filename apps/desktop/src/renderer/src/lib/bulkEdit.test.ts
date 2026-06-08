import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { commonValue } from './bulkEdit'

const emptyMeta: TrackMetadata = {
  title: '',
  artist: '',
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
}

function track(meta: Partial<TrackMetadata>): TrackItem {
  return {
    id: Math.random().toString(),
    inputPath: '/x.flac',
    fileName: 'x.flac',
    listLabel: meta.title ?? 'x.flac',
    query: '',
    meta: { ...emptyMeta, ...meta },
    status: 'idle',
  }
}

describe('commonValue', () => {
  it('returns the shared value when every track agrees', () => {
    const tracks = [track({ album: 'Hard House Nation' }), track({ album: 'Hard House Nation' })]
    expect(commonValue(tracks, 'album')).toBe('Hard House Nation')
  })

  it('returns undefined when the tracks disagree, so the panel can flag it as mixed', () => {
    const tracks = [track({ artist: 'Kumara' }), track({ artist: 'B.F.I.' })]
    expect(commonValue(tracks, 'artist')).toBeUndefined()
  })

  it('treats a value all tracks leave empty as a shared empty, not as mixed', () => {
    // A blank everyone shares must read back as "" (editable, no mixed hint), so the
    // user can fill a field that is uniformly empty across the selection.
    const tracks = [track({}), track({})]
    expect(commonValue(tracks, 'genre')).toBe('')
  })

  it('returns the single track’s value when only one is selected', () => {
    expect(commonValue([track({ year: '2000' })], 'year')).toBe('2000')
  })

  it('returns undefined for an empty selection', () => {
    expect(commonValue([], 'album')).toBeUndefined()
  })
})
