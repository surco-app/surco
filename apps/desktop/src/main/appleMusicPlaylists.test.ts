import { describe, expect, it } from 'vitest'
import {
  buildPlaylistDumpScript,
  buildPlaylistTracksScript,
  parsePlaylistDump,
  parsePlaylistTracks,
} from './appleMusicPlaylists'

// Fields are unit-separated and rows record-separated, matching what the script emits:
// grouping and comment are user-typed and can hold both a tab and a newline.
const US = '\u001f'
const RS = '\u001e'
function trackRow(path: string, persistentId = ''): string {
  return [path, persistentId, '', '0', '', '0', '0', '0', '0', 'computed'].join(US)
}

describe('buildPlaylistDumpScript', () => {
  it('reads the user playlists only, so the whole library and the smart folders Music ships with are not offered as crates', () => {
    const script = buildPlaylistDumpScript()
    expect(script).toContain('every user playlist')
    expect(script).not.toContain('library playlist')
  })

  it('returns empty for a library with no playlists instead of raising -1728 on the property of an empty list', () => {
    // Same shape as buildLibraryDumpScript: asking for a property of every item of an
    // empty list throws "Can't get name of every user playlist (-1728)", which would
    // fail the whole dialog on a fresh Mac rather than opening it empty.
    const script = buildPlaylistDumpScript()
    expect(script).toContain('if (count of userPlaylists) is 0 then return ""')
  })

  it('carries the persistent ID so the chosen playlist is re-found by identity, not by a name the user can rename mid-flow', () => {
    expect(buildPlaylistDumpScript()).toContain('persistent ID')
  })

  it('counts each playlist one at a time, because the bulk form collapses to a single number', () => {
    // Measured against Music on macOS 26: `count of tracks of every user playlist` does
    // NOT return one count per playlist, it returns a single number (0 here). Indexing
    // into that failed the whole dump with "Can't make item 1 of 0 into type Unicode
    // text. (-1700)". Only a per-playlist read gives a count per row.
    const script = buildPlaylistDumpScript()
    expect(script).not.toContain('count of tracks of every user playlist')
    expect(script).toContain('count of tracks of p')
  })
})

describe('parsePlaylistDump', () => {
  it('reads name, count and persistent ID', () => {
    const rows = parsePlaylistDump('Sesión sábado\t128\tA1B2C3D4E5F60718')
    expect(rows).toEqual([{ name: 'Sesión sábado', count: 128, persistentId: 'A1B2C3D4E5F60718' }])
  })

  it('keeps a playlist whose name contains a tab, peeling the trailing fields instead of splitting left to right', () => {
    // The same hazard parseLibraryDump guards: a left-to-right split would hand back
    // a truncated name and read the rest of the name as the count.
    const rows = parsePlaylistDump('Bases\tNoche\t550\tFFEEDDCCBBAA9988')
    expect(rows[0].name).toBe('Bases\tNoche')
    expect(rows[0].count).toBe(550)
  })

  it('drops a row with no name so a trailing newline never becomes a nameless playlist', () => {
    expect(parsePlaylistDump('Sesión\t12\tA1B2C3D4E5F60718\n\n')).toHaveLength(1)
  })

  it('keeps an empty playlist, which is a real thing to pick and must not look like a parse failure', () => {
    expect(parsePlaylistDump('Por clasificar\t0\tA1B2C3D4E5F60718')[0].count).toBe(0)
  })
})

describe('buildPlaylistTracksScript', () => {
  it('finds the playlist by persistent ID, so a rename between opening the dialog and importing cannot load the wrong crate', () => {
    const script = buildPlaylistTracksScript('A1B2C3D4E5F60718')
    expect(script).toContain('"A1B2C3D4E5F60718"')
    expect(script).toContain('persistent ID')
  })

  it('reads each track location inside a try, so one streaming track does not abort the whole import', () => {
    // A playlist mixes the user's own files with Apple Music streaming tracks, which
    // have no file at all: `location` on one of those raises, and without the guard a
    // single streaming row would fail an import of 128 real files.
    const script = buildPlaylistTracksScript('A1B2C3D4E5F60718')
    expect(script).toContain('try')
    expect(script).toContain('end try')
  })

  it('returns empty for a playlist with no tracks rather than raising on the property of an empty list', () => {
    expect(buildPlaylistTracksScript('A1B2C3D4E5F60718')).toContain('is 0 then return ""')
  })

  it('fetches the locations and IDs as whole lists, not one round trip per track', () => {
    // Measured against Music on macOS 26 with a 400-track playlist: reading each track
    // inside a repeat loop costs 14.34s, the same read as two bulk property fetches costs
    // 1.39s for an identical result. Unlike `count of tracks`, these two DO return one
    // item per track, so the bulk form is both correct and ten times cheaper.
    const script = buildPlaylistTracksScript('A1B2C3D4E5F60718')
    expect(script).toContain('location of every track')
    expect(script).toContain('persistent ID of every track')
  })

  it('converts the alias to a POSIX path outside the Music tell block, where that coercion exists', () => {
    // Measured against Music on macOS 26: `POSIX path of (location of t)` INSIDE a
    // `tell application "Music"` block yields an empty string with no error — POSIX path
    // is a system coercion, not one of Music's own. Every track then looked like it had
    // no file, so a playlist of 400 real files imported nothing and reported all 400 as
    // missing. The alias must leave the tell block before being coerced.
    const lines = buildPlaylistTracksScript('A1B2C3D4E5F60718').split('\n')
    // Walk the script tracking tell-block depth, and assert the POSIX coercion happens at
    // depth zero. Counting `end tell` before it is not enough: a nested tell would also
    // satisfy that while reintroducing the bug.
    let depth = 0
    let posixDepth: number | null = null
    for (const line of lines) {
      const t = line.trim()
      if (t.startsWith('tell application')) depth += 1
      if (t === 'end tell') depth -= 1
      if (t.includes('POSIX path')) posixDepth = depth
    }
    expect(posixDepth).toBe(0)
  })
})

describe('parsePlaylistTracks', () => {
  it('returns the POSIX paths of the tracks that have a file', () => {
    const out = parsePlaylistTracks(
      [trackRow('/Users/dj/Music/a.aiff'), trackRow('/Users/dj/Music/b.flac')].join(RS),
    )
    expect(out.paths).toEqual(['/Users/dj/Music/a.aiff', '/Users/dj/Music/b.flac'])
  })

  it('counts the tracks with no file instead of dropping them silently, so the status bar can say why fewer rows arrived', () => {
    // A user who counts 128 in Music and sees 122 in Surco has no way to tell which
    // six are missing or why. The count is what lets the app say it out loud.
    const out = parsePlaylistTracks(
      [
        trackRow('/Users/dj/Music/a.aiff'),
        trackRow(''),
        trackRow(''),
        trackRow('/Users/dj/Music/b.flac'),
      ].join(RS),
    )
    expect(out.paths).toHaveLength(2)
    expect(out.missing).toBe(2)
  })

  it('reports zero missing when every track has a file', () => {
    expect(parsePlaylistTracks(trackRow('/Users/dj/a.aiff')).missing).toBe(0)
  })

  it('ignores a trailing newline rather than counting it as a track with no file', () => {
    const out = parsePlaylistTracks(`${trackRow('/Users/dj/a.aiff')}${RS}`)
    expect(out.paths).toHaveLength(1)
    expect(out.missing).toBe(0)
  })
})

describe('carrying each track back to its library entry', () => {
  it('pairs every path with the persistent ID of the Music entry it came from', () => {
    // Without this, converting an imported track adds a SECOND entry to the library
    // instead of updating the one it came from: the update path keys off the persistent
    // ID, and a track imported without one looks to Surco like a file it has never seen.
    const out = parsePlaylistTracks(
      [trackRow('/m/a.aiff', 'A1B2C3D4E5F60718'), trackRow('/m/b.flac', 'FFEEDDCCBBAA9988')].join(
        RS,
      ),
    )
    expect(out.paths).toEqual(['/m/a.aiff', '/m/b.flac'])
    expect(out.persistentIds).toEqual({
      '/m/a.aiff': 'A1B2C3D4E5F60718',
      '/m/b.flac': 'FFEEDDCCBBAA9988',
    })
  })

  it('pairs each ID with its own location by index, so a row never inherits a neighbour’s', () => {
    // The two bulk fetches come back as parallel lists; the output line must join item i
    // of one to item i of the other. Reading either with a fixed index would stamp every
    // track with the first entry's identity.
    const script = buildPlaylistTracksScript('A1B2C3D4E5F60718')
    expect(script).toContain('item i of theLocs')
    expect(script).toContain('item i of thePids')
  })

  it('keeps a path whose name contains a tab, which the unit separator makes harmless', () => {
    const out = parsePlaylistTracks(trackRow('/m/od\td.aiff', 'A1B2C3D4E5F60718'))
    expect(out.paths).toEqual(['/m/od\td.aiff'])
    expect(out.persistentIds['/m/od\td.aiff']).toBe('A1B2C3D4E5F60718')
  })

  it('keeps the first entry when two rows point at the same file, so the ID matches the row that is imported', () => {
    // Measured on a real library: a 982-track playlist yielded 982 paths but only 981
    // distinct ones — two entries in Music point at the same file. The import dedupes and
    // keeps the FIRST row, so the map has to keep the first entry's ID; taking the last
    // would stamp the surviving row with the identity of an entry that was dropped, and a
    // later conversion would update the wrong library copy.
    const out = parsePlaylistTracks(
      [trackRow('/m/a.aiff', 'A1B2C3D4E5F60718'), trackRow('/m/a.aiff', 'FFEEDDCCBBAA9988')].join(
        RS,
      ),
    )
    expect(out.paths).toEqual(['/m/a.aiff'])
    expect(out.persistentIds['/m/a.aiff']).toBe('A1B2C3D4E5F60718')
  })

  it('still counts a track with no file, which carries no path to key an ID on', () => {
    const out = parsePlaylistTracks(
      [trackRow('/m/a.aiff', 'A1B2C3D4E5F60718'), trackRow('', '0011223344556677')].join(RS),
    )
    expect(out.paths).toHaveLength(1)
    expect(out.missing).toBe(1)
  })
})
