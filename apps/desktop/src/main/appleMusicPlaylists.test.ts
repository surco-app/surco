import { describe, expect, it } from 'vitest'
import {
  buildPlaylistDumpScript,
  buildPlaylistTracksScript,
  parsePlaylistDump,
  parsePlaylistTracks,
} from './appleMusicPlaylists'

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
})

describe('parsePlaylistTracks', () => {
  it('returns the POSIX paths of the tracks that have a file', () => {
    const out = parsePlaylistTracks('/Users/dj/Music/a.aiff\n/Users/dj/Music/b.flac')
    expect(out.paths).toEqual(['/Users/dj/Music/a.aiff', '/Users/dj/Music/b.flac'])
  })

  it('counts the tracks with no file instead of dropping them silently, so the status bar can say why fewer rows arrived', () => {
    // A user who counts 128 in Music and sees 122 in Surco has no way to tell which
    // six are missing or why. The count is what lets the app say it out loud.
    const out = parsePlaylistTracks('/Users/dj/Music/a.aiff\n\n\n/Users/dj/Music/b.flac')
    expect(out.paths).toHaveLength(2)
    expect(out.missing).toBe(2)
  })

  it('reports zero missing when every track has a file', () => {
    expect(parsePlaylistTracks('/Users/dj/a.aiff').missing).toBe(0)
  })

  it('ignores a trailing newline rather than counting it as a track with no file', () => {
    const out = parsePlaylistTracks('/Users/dj/a.aiff\n')
    expect(out.paths).toHaveLength(1)
    expect(out.missing).toBe(0)
  })
})

describe('carrying each track back to its library entry', () => {
  it('pairs every path with the persistent ID of the Music entry it came from', () => {
    // Without this, converting an imported track adds a SECOND entry to the library
    // instead of updating the one it came from: the update path keys off the persistent
    // ID, and a track imported without one looks to Surco like a file it has never seen.
    const out = parsePlaylistTracks('/m/a.aiff\tA1B2C3D4E5F60718\n/m/b.flac\tFFEEDDCCBBAA9988')
    expect(out.paths).toEqual(['/m/a.aiff', '/m/b.flac'])
    expect(out.persistentIds).toEqual({
      '/m/a.aiff': 'A1B2C3D4E5F60718',
      '/m/b.flac': 'FFEEDDCCBBAA9988',
    })
  })

  it('asks Music for the persistent ID alongside each location', () => {
    expect(buildPlaylistTracksScript('A1B2C3D4E5F60718')).toContain('persistent ID of t')
  })

  it('keeps a path whose name contains a tab, peeling the ID off the end', () => {
    const out = parsePlaylistTracks('/m/od\td.aiff\tA1B2C3D4E5F60718')
    expect(out.paths).toEqual(['/m/od\td.aiff'])
    expect(out.persistentIds['/m/od\td.aiff']).toBe('A1B2C3D4E5F60718')
  })

  it('still counts a track with no file, which carries no path to key an ID on', () => {
    const out = parsePlaylistTracks('/m/a.aiff\tA1B2C3D4E5F60718\n\t0011223344556677')
    expect(out.paths).toHaveLength(1)
    expect(out.missing).toBe(1)
  })
})
