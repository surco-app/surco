import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { AppleMusicTrackMeta, TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { appleMusicFillPatch, fillFromAppleMusic } from './appleMusicFill'

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

function track(over: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 't1',
    inputPath: '/m/Weekend (Extended).wav',
    fileName: 'Weekend (Extended).wav',
    listLabel: 'Weekend (Extended)',
    query: '',
    status: 'idle',
    meta: meta({ title: 'Weekend (Extended)', artist: 'Tantra', genre: 'Electronic' }),
    ...over,
  }
}

const cover = { coverPath: '/art/PID.jpg', coverUrl: 'data:image/jpeg;base64,ART' }

describe('filling a loaded file with what Music holds for it', () => {
  it('fills the grouping the WAV cannot carry and keeps what the file has', () => {
    // Reported 30/09 with a Tantra WAV: Music showed "Cantaditas, Rockola, Yesterday"
    // while Surco showed an empty grouping, because the file itself holds only RIFF INFO.
    const patch = appleMusicFillPatch(track(), { grouping: 'Cantaditas, Rockola, Yesterday' })
    expect(patch?.meta?.grouping).toBe('Cantaditas, Rockola, Yesterday')
    expect(patch?.meta?.genre).toBe('Electronic')
  })

  it("gives the row and the editor Music's artwork when the file carries none", () => {
    const patch = appleMusicFillPatch(track(), cover)
    expect(patch).toMatchObject({
      coverPath: '/art/PID.jpg',
      coverUrl: 'data:image/jpeg;base64,ART',
      embeddedCover: 'data:image/jpeg;base64,ART',
    })
  })

  it('never replaces a cover already shown', () => {
    const patch = appleMusicFillPatch(track({ coverUrl: 'data:own' }), cover)
    expect(patch).toBeNull()
  })

  it('does not bring back a cover the user removed by hand', () => {
    expect(appleMusicFillPatch(track({ coverRemoved: true }), cover)).toBeNull()
  })

  it('returns null when Music has nothing the file lacks, so opening a track stages no change', () => {
    const full = track({ meta: meta({ grouping: 'Bases' }) })
    expect(appleMusicFillPatch(full, { grouping: 'Otra' })).toBeNull()
  })
})
