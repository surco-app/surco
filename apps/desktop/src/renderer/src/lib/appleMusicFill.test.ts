import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { AppleMusicTrackMeta, TrackMetadata } from '../../../shared/types'
import { fillFromAppleMusic } from './appleMusicFill'

function meta(over: Partial<TrackMetadata> = {}): TrackMetadata {
  return { ...emptyMetadata(), ...over }
}

describe('filling a track with what Music knows', () => {
  it('fills a field the file left empty', () => {
    // The case that started this: the user's WAVs carry no grouping, but Music holds
    // "Bases, Chocolate" for the same track, so the editor showed an empty field for
    // something the user had clearly filled in.
    const out = fillFromAppleMusic(meta(), { grouping: 'Bases, Chocolate' })
    expect(out.grouping).toBe('Bases, Chocolate')
  })

  it('leaves a field the file already carries, because the file is what other tools read', () => {
    const out = fillFromAppleMusic(meta({ year: '1995' }), { year: '2020' })
    expect(out.year).toBe('1995')
  })

  it('fills every field Music can supply', () => {
    const from: AppleMusicTrackMeta = {
      grouping: 'Bases',
      year: '2020',
      comment: 'rip de vinilo',
      trackNumber: '3',
      discNumber: '2',
      bpm: '140',
    }
    const out = fillFromAppleMusic(meta(), from)
    expect(out).toMatchObject(from)
  })

  it('changes nothing when Music knows nothing', () => {
    const before = meta({ title: 'Oonk' })
    expect(fillFromAppleMusic(before, {})).toEqual(before)
  })

  it('treats whitespace in the file as empty, so a blank field still gets filled', () => {
    const out = fillFromAppleMusic(meta({ grouping: '   ' }), { grouping: 'Bases' })
    expect(out.grouping).toBe('Bases')
  })

  it('converts the Music rating to the stars the file stores', () => {
    // Music scales stars 0-100 (the same scale Engine DJ uses); the tag holds "1"-"5".
    // Carrying the raw number through would write a 80-star rating into the file.
    expect(fillFromAppleMusic(meta(), { rating: 80 }).rating).toBe('4')
    expect(fillFromAppleMusic(meta(), { rating: 100 }).rating).toBe('5')
    expect(fillFromAppleMusic(meta(), { rating: 20 }).rating).toBe('1')
  })

  it('leaves stars the file already carries', () => {
    expect(fillFromAppleMusic(meta({ rating: '5' }), { rating: 20 }).rating).toBe('5')
  })

  it('returns the same object when there is nothing to add, so an import does not churn state', () => {
    const before = meta({ grouping: 'Bases' })
    expect(fillFromAppleMusic(before, { grouping: 'Otra cosa' })).toBe(before)
  })
})
