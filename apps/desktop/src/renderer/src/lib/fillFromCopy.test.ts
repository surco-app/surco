import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackMetadata } from '../../../shared/types'
import { fillFromCopy, groupingFromCopy } from './fillFromCopy'

const meta = (fields: Partial<TrackMetadata>): TrackMetadata => ({ ...emptyMetadata(), ...fields })

describe('fillFromCopy', () => {
  it('fills the required fields the replacement would otherwise make the DJ retype', () => {
    const filled = fillFromCopy(
      meta({ title: 'Your Love (Power Love Mix)', artist: '2 Shy' }),
      meta({ album: 'Your Love', year: '1996', genre: 'Euro House', grouping: 'Cantaditas' }),
    )
    expect(filled).toMatchObject({
      title: 'Your Love (Power Love Mix)',
      artist: '2 Shy',
      album: 'Your Love',
      year: '1996',
      genre: 'Euro House',
      grouping: 'Cantaditas',
    })
  })

  it('never overwrites what the new file or the DJ already wrote', () => {
    const filled = fillFromCopy(
      meta({ album: 'Your Love (Remixes)', genre: '' }),
      meta({ album: 'Your Love', genre: 'Euro House' }),
    )
    expect(filled).toMatchObject({ album: 'Your Love (Remixes)', genre: 'Euro House' })
  })

  it('keeps the title and artist of the file in hand, since they decided the match', () => {
    const filled = fillFromCopy(
      meta({ title: '', artist: '', album: '' }),
      meta({ title: 'Old Title', artist: 'Old Artist', album: 'Your Love' }),
    )
    expect(filled).toMatchObject({ title: '', artist: '', album: 'Your Love' })
  })

  it('leaves the encoder out, it describes the old file and not the song', () => {
    const filled = fillFromCopy(
      meta({ album: '' }),
      meta({ album: 'Your Love', encodedBy: 'LAME 3.99' }),
    )
    expect(filled?.encodedBy ?? '').toBe('')
  })

  it('fills the DJ own custom fields that the new file lacks', () => {
    const filled = fillFromCopy(
      meta({ custom: { vinylCondition: '' } }),
      meta({ custom: { vinylCondition: 'VG+', shelf: 'B3' } }),
    )
    expect(filled?.custom).toEqual({ vinylCondition: 'VG+', shelf: 'B3' })
  })

  it('treats a blank value as empty so whitespace does not block the fill', () => {
    const filled = fillFromCopy(meta({ genre: '  ' }), meta({ genre: 'Euro House' }))
    expect(filled?.genre).toBe('Euro House')
  })

  it('returns null when the copy has nothing to add, so the track is not touched', () => {
    expect(
      fillFromCopy(meta({ album: 'Your Love' }), meta({ album: 'Other', genre: '' })),
    ).toBeNull()
  })
})

describe('groupingFromCopy', () => {
  // Another version of the track sits in the DJ's library under the grouping the DJ filed it
  // with, but its album, year or label are that other release's.
  it('lends only the grouping the DJ filed the other version under, never its album', () => {
    const filled = groupingFromCopy(
      meta({ title: 'Rockola', album: '' }),
      meta({ grouping: 'Bases, Rockola', album: 'Other Release', year: '1999' }),
    )
    expect(filled).toMatchObject({ title: 'Rockola', grouping: 'Bases, Rockola', album: '' })
    expect(filled?.year ?? '').toBe('')
  })

  it('keeps a grouping the file or the DJ already wrote', () => {
    expect(groupingFromCopy(meta({ grouping: 'Mine' }), meta({ grouping: 'Bases' }))).toBeNull()
  })

  it('returns null when the copy has no grouping, so the track is not touched', () => {
    expect(groupingFromCopy(meta({}), meta({ grouping: '  ', album: 'Other' }))).toBeNull()
  })
})
