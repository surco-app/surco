import { describe, expect, it } from 'vitest'
import { buildPlaylistTracksScript, parsePlaylistTracks } from './appleMusicPlaylists'

// One row per track in the order the script writes them. Unit separator between fields and
// record separator between rows: both are control characters a user cannot type into a
// Music field, unlike the tab and newline that free text really can contain.
const US = '\u001f'
const RS = '\u001e'
function row(fields: Partial<Record<string, string>>): string {
  return [
    fields.path ?? '',
    fields.persistentId ?? '',
    fields.grouping ?? '',
    fields.year ?? '0',
    fields.comment ?? '',
    fields.trackNumber ?? '0',
    fields.discNumber ?? '0',
    fields.bpm ?? '0',
    fields.rating ?? '0',
    fields.ratingKind ?? 'computed',
  ].join(US)
}

describe('what Music knows that the file does not', () => {
  it('carries the grouping, which lives only in the Music database for an untagged WAV', () => {
    // Measured on a real library: the WAV carries title/artist/album/year/genre and nothing
    // else, while Music holds "Bases, Chocolate" for the same track. Reading only the file
    // left the field empty in the editor even though the user had filled it in Music.
    const out = parsePlaylistTracks(row({ path: '/m/a.wav', grouping: 'Bases, Chocolate' }))
    expect(out.meta['/m/a.wav'].grouping).toBe('Bases, Chocolate')
  })

  it('carries year, comment, track and disc numbers', () => {
    const out = parsePlaylistTracks(
      row({
        path: '/m/a.wav',
        year: '2020',
        comment: 'ripped from vinyl',
        trackNumber: '3',
        discNumber: '2',
      }),
    )
    const m = out.meta['/m/a.wav']
    expect(m.year).toBe('2020')
    expect(m.comment).toBe('ripped from vinyl')
    expect(m.trackNumber).toBe('3')
    expect(m.discNumber).toBe('2')
  })

  it('treats Music zeros as absent, because zero is how Music says "unset"', () => {
    // Measured: an untouched track reports year 0, track number 0/0, disc 0/0 and bpm 0.
    // Carrying those through would stamp "0" over fields the file left empty, which reads
    // as data the user never entered.
    const out = parsePlaylistTracks(row({ path: '/m/a.wav' }))
    const m = out.meta['/m/a.wav']
    expect(m.year).toBeUndefined()
    expect(m.trackNumber).toBeUndefined()
    expect(m.discNumber).toBeUndefined()
    expect(m.bpm).toBeUndefined()
  })

  it('keeps a rating the user set', () => {
    const out = parsePlaylistTracks(row({ path: '/m/a.wav', rating: '80', ratingKind: 'user' }))
    expect(out.meta['/m/a.wav'].rating).toBe(80)
  })

  it('drops a rating Music computed itself, which is not the user’s opinion', () => {
    // Measured across a 400-track playlist: not one had a user rating, every one reported
    // `rating kind: computed`. Importing those would write stars the user never gave.
    const out = parsePlaylistTracks(row({ path: '/m/a.wav', rating: '60', ratingKind: 'computed' }))
    expect(out.meta['/m/a.wav'].rating).toBeUndefined()
  })

  it('asks Music for every field it is expected to carry', () => {
    const script = buildPlaylistTracksScript('A1B2C3D4E5F60718')
    for (const field of [
      'grouping of every track',
      'year of every track',
      'comment of every track',
      'track number of every track',
      'disc number of every track',
      'bpm of every track',
      'rating of every track',
      'rating kind of every track',
    ]) {
      expect(script).toContain(field)
    }
  })

  it('still reads the path and identity it always did', () => {
    const out = parsePlaylistTracks(row({ path: '/m/a.wav', persistentId: 'A1B2C3D4E5F60718' }))
    expect(out.paths).toEqual(['/m/a.wav'])
    expect(out.persistentIds['/m/a.wav']).toBe('A1B2C3D4E5F60718')
  })

  it('still counts a track with no file and keeps no metadata for it', () => {
    const out = parsePlaylistTracks(row({ path: '', grouping: 'Bases' }))
    expect(out.paths).toHaveLength(0)
    expect(out.missing).toBe(1)
    expect(Object.keys(out.meta)).toHaveLength(0)
  })

  it('survives a tab inside a free-text field, which would otherwise shift every column', () => {
    // Grouping and comment are user-typed, so a tab in either is possible even though none
    // of 800 real fields held one. With ten columns there is no peeling from the end that
    // recovers from it: one stray tab would misread every field after it, for that track
    // and, if the row count shifted, for the rest of the import.
    const out = parsePlaylistTracks(
      row({ path: '/m/a.wav', grouping: 'Bases\tNoche', comment: 'rip\tvinilo' }),
    )
    expect(out.meta['/m/a.wav'].grouping).toBe('Bases\tNoche')
    expect(out.meta['/m/a.wav'].comment).toBe('rip\tvinilo')
  })

  it('survives a newline inside a comment, which would otherwise look like another track', () => {
    const out = parsePlaylistTracks(row({ path: '/m/a.wav', comment: 'BPM 140\nKey Am' }))
    expect(out.paths).toHaveLength(1)
    expect(out.meta['/m/a.wav'].comment).toBe('BPM 140\nKey Am')
  })

  it('keeps each track’s fields with its own row across a whole playlist', () => {
    const out = parsePlaylistTracks(
      [
        row({ path: '/m/a.wav', grouping: 'Bases', comment: 'nota\ncon salto' }),
        row({ path: '/m/b.wav', grouping: 'Vocales' }),
        row({ path: '/m/c.wav', grouping: 'Melodías', rating: '100', ratingKind: 'user' }),
      ].join(RS),
    )
    expect(out.paths).toEqual(['/m/a.wav', '/m/b.wav', '/m/c.wav'])
    expect(out.meta['/m/b.wav'].grouping).toBe('Vocales')
    expect(out.meta['/m/c.wav'].rating).toBe(100)
    // The newline inside the first comment must not have split that track into two.
    expect(out.meta['/m/a.wav'].grouping).toBe('Bases')
  })
})
