import { describe, expect, it } from 'vitest'
import { parseFileName } from './filename'
import { searchFromTags } from './search'

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
