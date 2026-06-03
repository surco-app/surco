import { describe, expect, it } from 'vitest'
import { parseFileName } from './filename'
import { parseReleaseId, searchFromTags } from './search'

describe('searchFromTags', () => {
  it('builds the query from embedded artist + title, ignoring a messier file name', () => {
    // the whole point: tags are cleaner than "01 - atb_till-i-come (FINAL).wav"
    const parsed = parseFileName('/m/01 - atb_till-i-come (FINAL).wav')
    const r = searchFromTags(parsed, { artist: 'ATB', title: 'Till I Come' })
    expect(r.query).toBe('ATB Till I Come')
    expect(r.artist).toBe('ATB')
    expect(r.title).toBe('Till I Come')
  })

  it('falls back to the file name only when neither title nor artist tag exists', () => {
    const parsed = parseFileName('/m/Chumi Dj - Open Your Eyes.wav')
    const r = searchFromTags(parsed, { artist: '', title: '' })
    expect(r.query).toBe('Chumi Dj Open Your Eyes')
    expect(r.artist).toBe('Chumi Dj')
    expect(r.title).toBe('Open Your Eyes')
  })

  it('uses the one tag it has and keeps the query to that tag', () => {
    const parsed = parseFileName('/m/Some Artist - Some Title.wav')
    const r = searchFromTags(parsed, { artist: '', title: 'Real Title' })
    expect(r.title).toBe('Real Title')
    expect(r.query).toBe('Real Title')
  })

  it('treats whitespace-only tags as missing so they do not override the file name', () => {
    const parsed = parseFileName('/m/Artist - Title.wav')
    const r = searchFromTags(parsed, { artist: '   ', title: '' })
    expect(r.query).toBe('Artist Title')
  })
})

describe('parseReleaseId', () => {
  // Discogs' /database/search treats a bare number as text, so "12345" finds
  // junk. Recognising it as a release id lets the editor hit /releases/{id}.
  it('reads a bare numeric id', () => {
    expect(parseReleaseId('12345')).toBe(12345)
    expect(parseReleaseId('  249504  ')).toBe(249504)
  })

  it('extracts the id from a discogs release URL, with or without locale and slug', () => {
    expect(parseReleaseId('https://www.discogs.com/release/249504-Various-Synthetic')).toBe(249504)
    expect(parseReleaseId('https://www.discogs.com/es/release/249504')).toBe(249504)
    expect(parseReleaseId('https://api.discogs.com/releases/249504')).toBe(249504)
  })

  it('reads the [r12345] BBCode form Discogs uses in forums', () => {
    expect(parseReleaseId('[r249504]')).toBe(249504)
  })

  it('returns null for real text searches so they still go to the text endpoint', () => {
    expect(parseReleaseId('DJ Duck Come Again')).toBeNull()
    expect(parseReleaseId('12345 come again')).toBeNull()
    expect(parseReleaseId('')).toBeNull()
  })
})
