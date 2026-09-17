import { describe, expect, it } from 'vitest'
import { fieldOf, summarizeTagChanges, tagChangeDetail } from './tagChanges'

// The user's own way of checking Surco was to compare the file in mp3tag before and
// after (17/09/2026). The panel now does that comparison for him after every
// conversion, so it has to count fields the way he would: a renamed field is one change
// on each side, a TXXX is known by its description, a picture by its role.
describe('summarizeTagChanges', () => {
  it('counts a renamed field on both spellings and keeps the rest', () => {
    const before = ['xiph ARTIST=A', 'xiph COMMENT=hi', 'xiph TITLE=T']
    const after = ['xiph ARTIST=A', 'xiph DESCRIPTION=hi', 'xiph TITLE=T']
    expect(summarizeTagChanges(before, after)).toEqual({
      changed: 2,
      kept: 2,
      fields: ['COMMENT', 'DESCRIPTION'],
    })
  })

  it('reports no change when the snapshots match', () => {
    const lines = ['id3 TIT2=T', 'id3 TPE1=A']
    expect(summarizeTagChanges(lines, lines)).toEqual({ changed: 0, kept: 2, fields: [] })
  })

  it('counts a changed value once per field, not once per line', () => {
    const before = ['xiph GENRE=House', 'xiph GENRE=Techno']
    const after = ['xiph GENRE=Tech House']
    expect(summarizeTagChanges(before, after).changed).toBe(1)
  })
})

describe('fieldOf', () => {
  it('names a TXXX frame by its description and any other frame by its id', () => {
    expect(fieldOf('id3 TXXX[ENERGYLEVEL]=7')).toBe('TXXX:ENERGYLEVEL')
    expect(fieldOf('id3 COMM[XXX,]=hi')).toBe('COMM')
    expect(fieldOf('id3 APIC[type=3,mime=image/jpeg,desc=x] sha1=ab len=1')).toBe('APIC')
    expect(fieldOf('riff IPRD=Album')).toBe('IPRD')
    expect(fieldOf('mp4 ©cmt=hi')).toBe('©cmt')
    expect(fieldOf('picture type=3 mime=image/jpeg sha1=ab len=1')).toBe('picture')
  })
})

describe('tagChangeDetail', () => {
  it('says nothing when either side could not be read', () => {
    expect(tagChangeDetail(null, ['xiph TITLE=T'])).toBeNull()
    expect(tagChangeDetail(['xiph TITLE=T'], null)).toBeNull()
  })

  it('names the changed fields, capped so the row stays one line', () => {
    const before = [
      'xiph A=1',
      'xiph B=1',
      'xiph C=1',
      'xiph D=1',
      'xiph E=1',
      'xiph F=1',
      'xiph G=1',
    ]
    const after = before.map((l) => `${l}x`)
    expect(tagChangeDetail(before, after)).toEqual({
      detailKey: 'activity.convertTagsChanged',
      detailParams: { changed: 7, kept: 0, fields: 'A, B, C, D, E, F…' },
    })
  })

  it('uses the unchanged wording when nothing moved', () => {
    expect(tagChangeDetail(['xiph A=1'], ['xiph A=1'])).toEqual({
      detailKey: 'activity.convertTagsUnchanged',
      detailParams: { kept: 1 },
    })
  })
})
