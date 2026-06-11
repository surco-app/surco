import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import { mergeReadMeta } from './readMerge'

function meta(over: Partial<TrackMetadata> = {}): TrackMetadata {
  return {
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
    ...over,
  }
}

describe('mergeReadMeta', () => {
  // The row is editable from the instant it lands, so the read can resolve after the
  // user typed. A field the user touched must never be reverted by the read.
  it('keeps a field the user edited while the read was in flight', () => {
    const imported = meta({ title: 'a' })
    const live = meta({ title: 'Hand Typed' })
    const read = meta({ title: 'a', artist: 'Tagged Artist' })
    const merged = mergeReadMeta(imported, live, read)
    expect(merged.title).toBe('Hand Typed')
    expect(merged.artist).toBe('Tagged Artist')
  })

  it('fills untouched fields from the read', () => {
    const imported = meta({ title: 'a' })
    const merged = mergeReadMeta(imported, imported, meta({ title: 'Tagged', year: '1997' }))
    expect(merged).toEqual(meta({ title: 'Tagged', year: '1997' }))
  })

  // Optional extras (rating, release id) the user set mid-read don't exist on the
  // read's object at all — they must survive the merge too.
  it('keeps optional fields the user set that the read does not carry', () => {
    const imported = meta()
    const live = meta({ rating: '4' })
    const merged = mergeReadMeta(imported, live, meta({ artist: 'Tagged Artist' }))
    expect(merged.rating).toBe('4')
    expect(merged.artist).toBe('Tagged Artist')
  })
})
