import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const { reads } = vi.hoisted(() => ({ reads: [] as string[] }))
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  const readFileSync = ((...args: Parameters<typeof real.readFileSync>) => {
    reads.push(String(args[0]))
    return real.readFileSync(...args)
  }) as typeof real.readFileSync
  return { ...real, readFileSync }
})

import { ALL_TRACKS_ID } from '../shared/allTracks'
import { RECENTLY_ADDED_ID } from '../shared/recentlyAdded'
import { parseSeratoLinkId, seratoLinkId } from './seratoCrateFile'
import { concat, frame, track, utf16be } from './seratoDatabaseFixture'
import {
  readSeratoLibrary,
  seratoCollection,
  seratoLibraryRoots,
  seratoMembership,
  seratoPlaylist,
  seratoRecentCount,
  seratoTrackCount,
  seratoTree,
} from './seratoLibrary'

const NOW = new Date(2026, 10, 3, 12)
const DAY = 24 * 3600
const daysAgo = (days: number) => String(Math.floor(NOW.getTime() / 1000) - days * DAY)

const database = (tracks: Record<string, string>[]) =>
  concat([
    frame('vrsn', utf16be('2.0/Serato Scratch LIVE Database')),
    ...tracks.map((t) => track(t)),
  ])

const crate = (paths: string[]) =>
  concat([
    frame('vrsn', utf16be('1.0/Serato ScratchLive Crate')),
    ...paths.map((p) => frame('otrk', frame('ptrk', utf16be(p)))),
  ])

function seratoFolder(
  base: string,
  tracks: Record<string, string>[],
  crates: Record<string, string[]> = {},
): string {
  const dir = join(base, '_Serato_')
  mkdirSync(join(dir, 'Subcrates'), { recursive: true })
  writeFileSync(join(dir, 'database V2'), database(tracks))
  for (const [name, paths] of Object.entries(crates))
    writeFileSync(join(dir, 'Subcrates', `${name}.crate`), crate(paths))
  return dir
}

function twoLibraries() {
  const base = mkdtempSync(join(tmpdir(), 'surco-serato-library-'))
  const home = join(base, 'home')
  const drive = join(base, 'Volumes', 'Gigs')
  const bare = join(base, 'Volumes', 'Backup')
  mkdirSync(bare, { recursive: true })
  seratoFolder(
    join(home, 'Music'),
    [
      { pfil: 'Users/dj/Music/old.mp3', tsng: 'Old', tart: 'Ann', tadd: daysAgo(90) },
      {
        pfil: 'Users/dj/Music/new.mp3',
        tsng: 'New',
        tart: 'Bob',
        tbpm: '128.00',
        tkey: '8A',
        tadd: daysAgo(2),
      },
    ],
    {
      House: ['Users/dj/Music/old.mp3', 'Users/dj/Music/new.mp3'],
      'House%%Deep': ['Users/dj/Music/new.mp3'],
    },
  )
  seratoFolder(drive, [{ pfil: 'Tracks/gig.flac', tsng: 'Gig', tadd: daysAgo(10) }], {
    House: ['Tracks/gig.flac'],
    Friday: ['Tracks/gig.flac'],
  })
  return { home, drive, bare, roots: seratoLibraryRoots(home, [drive, bare]) }
}

describe('seratoLibraryRoots', () => {
  it('takes the home library from the boot disk root and each drive library from its own mount', () => {
    const { home, drive, roots } = twoLibraries()
    expect(roots).toEqual([
      { dir: join(home, 'Music', '_Serato_'), root: '/' },
      { dir: join(drive, '_Serato_'), root: drive },
    ])
  })

  it('finds nothing where Serato never ran, so the tab stays hidden', () => {
    const base = mkdtempSync(join(tmpdir(), 'surco-serato-library-'))
    expect(seratoLibraryRoots(base, [base])).toEqual([])
  })
})

describe('readSeratoLibrary', () => {
  it('joins the home and drive libraries, with every path absolute, like Serato shows them together', () => {
    const { drive, roots } = twoLibraries()
    const library = readSeratoLibrary(roots)
    expect(library.tracks.map((t) => t.file)).toEqual([
      '/Users/dj/Music/old.mp3',
      '/Users/dj/Music/new.mp3',
      join(drive, 'Tracks/gig.flac'),
    ])
    expect(library.crates.get('House')).toEqual([
      '/Users/dj/Music/old.mp3',
      '/Users/dj/Music/new.mp3',
      join(drive, 'Tracks/gig.flac'),
    ])
  })

  it('keeps the other libraries when a drive was unplugged after the roots were found', () => {
    const { drive, roots } = twoLibraries()
    rmSync(drive, { recursive: true })
    const library = readSeratoLibrary(roots)
    expect(library.tracks.map((t) => t.file)).toEqual([
      '/Users/dj/Music/old.mp3',
      '/Users/dj/Music/new.mp3',
    ])
    expect([...library.crates.keys()].sort()).toEqual(['House', 'House%%Deep'])
  })
})

describe('the Serato tab', () => {
  it('nests subcrates under a parent crate that still lists its own tracks, merged across drives', () => {
    const library = readSeratoLibrary(twoLibraries().roots)
    expect(seratoTree(library)).toEqual([
      { id: 'Friday', name: 'Friday', kind: 'playlist', count: 1 },
      {
        id: 'House',
        name: 'House',
        kind: 'playlist',
        count: 3,
        children: [{ id: 'House%%Deep', name: 'Deep', kind: 'playlist', count: 1 }],
      },
    ])
    expect(seratoPlaylist(library, 'House', NOW).map((e) => e.linkId)).toHaveLength(3)
  })

  it('opens a parent crate that has no file of its own as an empty list, not an error', () => {
    const base = mkdtempSync(join(tmpdir(), 'surco-serato-library-'))
    seratoFolder(join(base, 'Music'), [{ pfil: 'a.mp3' }], { 'Sets%%Friday': ['a.mp3'] })
    const library = readSeratoLibrary(seratoLibraryRoots(base, []))
    expect(seratoTree(library).map((n) => [n.id, n.kind])).toEqual([['Sets', 'folder']])
    expect(seratoPlaylist(library, 'Sets', NOW)).toEqual([])
    expect(seratoPlaylist(library, 'Sets%%Friday', NOW).map((e) => e.path)).toEqual(['/a.mp3'])
  })

  it('counts every track of both libraries in All tracks', () => {
    const library = readSeratoLibrary(twoLibraries().roots)
    expect(seratoTrackCount(library)).toBe(3)
    expect(seratoPlaylist(library, ALL_TRACKS_ID, NOW)).toHaveLength(3)
  })

  it('lists the collection as title, artist and content id for matching a pasted tracklist', () => {
    const library = readSeratoLibrary(twoLibraries().roots)
    const rows = seratoCollection(library)
    expect(rows).toHaveLength(3)
    expect(rows.find((r) => r.title === 'Old')).toEqual({
      contentId: 'serato:/Users/dj/Music/old.mp3',
      path: '/Users/dj/Music/old.mp3',
      title: 'Old',
      artist: 'Ann',
    })
  })

  it('lists in Recently added only what Serato added in the last 30 days, newest first', () => {
    const { drive, roots } = twoLibraries()
    const library = readSeratoLibrary(roots)
    expect(seratoRecentCount(library, NOW)).toBe(2)
    expect(seratoPlaylist(library, RECENTLY_ADDED_ID, NOW).map((e) => e.path)).toEqual([
      '/Users/dj/Music/new.mp3',
      join(drive, 'Tracks/gig.flac'),
    ])
  })

  it('gives a crate its tracks in the order the DJ arranged, each one marked as a Serato track', () => {
    const { home, drive, roots } = twoLibraries()
    const homeHouse = join(home, 'Music', '_Serato_', 'Subcrates', 'House.crate')
    const driveHouse = join(drive, '_Serato_', 'Subcrates', 'House.crate')
    const entries = seratoPlaylist(readSeratoLibrary(roots), 'House', NOW)
    expect(entries).toEqual([
      {
        path: '/Users/dj/Music/old.mp3',
        separator: false,
        meta: {},
        contentId: 'serato:/Users/dj/Music/old.mp3',
        linkId: seratoLinkId(0, homeHouse, 'Users/dj/Music/old.mp3'),
      },
      {
        path: '/Users/dj/Music/new.mp3',
        separator: false,
        meta: { bpm: '128', key: '8A' },
        contentId: 'serato:/Users/dj/Music/new.mp3',
        linkId: seratoLinkId(1, homeHouse, 'Users/dj/Music/new.mp3'),
      },
      {
        path: join(drive, 'Tracks/gig.flac'),
        separator: false,
        meta: {},
        contentId: `serato:${join(drive, 'Tracks/gig.flac')}`,
        linkId: seratoLinkId(0, driveHouse, 'Tracks/gig.flac'),
      },
    ])
  })

  it('gives every crate row a link id the edit can resolve', () => {
    const base = mkdtempSync(join(tmpdir(), 'surco-serato-library-'))
    const dir = seratoFolder(join(base, 'Music'), [{ pfil: 'a.mp3' }])
    const file = join(dir, 'Subcrates', 'A.crate')
    writeFileSync(
      file,
      concat([
        frame('otrk', frame('ptrk', utf16be('a.mp3'))),
        frame('otrk', frame('tvcn', utf16be('no path'))),
        frame('otrk', frame('ptrk', utf16be('b.mp3'))),
      ]),
    )
    const entries = seratoPlaylist(readSeratoLibrary(seratoLibraryRoots(base, [])), 'A', NOW)
    expect(entries.map((e) => parseSeratoLinkId(e.linkId ?? ''))).toEqual([
      { index: 0, crateFile: file, path: 'a.mp3' },
      { index: 2, crateFile: file, path: 'b.mp3' },
    ])
  })

  it('gives no link id in Recently added or All tracks, which are no crate', () => {
    const { roots } = twoLibraries()
    const library = readSeratoLibrary(roots)
    const rows = [
      ...seratoPlaylist(library, RECENTLY_ADDED_ID, NOW),
      ...seratoPlaylist(library, ALL_TRACKS_ID, NOW),
    ]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((e) => !('linkId' in e))).toBe(true)
  })

  it('says which crates hold each file, so the playlists field can fill in', () => {
    const { drive, roots } = twoLibraries()
    const gig = join(drive, 'Tracks/gig.flac')
    expect(
      seratoMembership(readSeratoLibrary(roots), [
        '/Users/dj/Music/new.mp3',
        gig,
        '/elsewhere.mp3',
      ]),
    ).toEqual({
      '/Users/dj/Music/new.mp3': ['House', 'House%%Deep'],
      [gig]: ['Friday', 'House'],
    })
  })

  it('matches a file whose name macOS handed over decomposed', () => {
    const base = mkdtempSync(join(tmpdir(), 'surco-serato-library-'))
    seratoFolder(join(base, 'Music'), [{ pfil: 'Música/canción.mp3' }], {
      Latin: ['Música/canción.mp3'],
    })
    const decomposed = '/Música/canción.mp3'.normalize('NFD')
    expect(seratoMembership(readSeratoLibrary(seratoLibraryRoots(base, [])), [decomposed])).toEqual(
      {
        [decomposed]: ['Latin'],
      },
    )
  })

  it('keeps bpm and key on a crate row whose path is in another Unicode form than the database', () => {
    const base = mkdtempSync(join(tmpdir(), 'surco-serato-library-'))
    seratoFolder(
      join(base, 'Music'),
      [{ pfil: 'Música/canción.mp3', tbpm: '124.00', tkey: '5A' }],
      {
        Latin: ['Música/canción.mp3'.normalize('NFD')],
      },
    )
    const library = readSeratoLibrary(seratoLibraryRoots(base, []))
    expect(seratoPlaylist(library, 'Latin', NOW).map((e) => e.meta)).toEqual([
      { bpm: '124', key: '5A' },
    ])
  })

  it('skips one crate it cannot read and keeps the rest of that library', () => {
    const base = mkdtempSync(join(tmpdir(), 'surco-serato-library-'))
    const dir = seratoFolder(join(base, 'Music'), [{ pfil: 'a.mp3' }], { Good: ['a.mp3'] })
    mkdirSync(join(dir, 'Subcrates', 'Broken.crate'))
    const library = readSeratoLibrary(seratoLibraryRoots(base, []))
    expect(library.tracks.map((t) => t.file)).toEqual(['/a.mp3'])
    expect(seratoPlaylist(library, 'Good', NOW).map((e) => e.path)).toEqual(['/a.mp3'])
  })
})

describe('reading the same Serato library again', () => {
  const readsOf = (dir: string) => reads.filter((r) => r.startsWith(dir))

  it('parses the database and each crate once while their files stay the same, since a NAS pays for every read', () => {
    const base = mkdtempSync(join(tmpdir(), 'surco-serato-library-'))
    const dir = seratoFolder(join(base, 'Music'), [{ pfil: 'a.mp3' }], { Good: ['a.mp3'] })
    const roots = seratoLibraryRoots(base, [])
    const first = readSeratoLibrary(roots)
    const second = readSeratoLibrary(roots)
    expect(second.tracks.map((t) => t.file)).toEqual(first.tracks.map((t) => t.file))
    expect(seratoPlaylist(second, 'Good', NOW).map((e) => e.path)).toEqual(['/a.mp3'])
    expect(readsOf(dir).sort()).toEqual(
      [join(dir, 'Subcrates', 'Good.crate'), join(dir, 'database V2')].sort(),
    )
  })

  it('parses a file again once Serato rewrote it', () => {
    const base = mkdtempSync(join(tmpdir(), 'surco-serato-library-'))
    const dir = seratoFolder(join(base, 'Music'), [{ pfil: 'a.mp3' }], { Good: ['a.mp3'] })
    const roots = seratoLibraryRoots(base, [])
    readSeratoLibrary(roots)
    writeFileSync(join(dir, 'database V2'), database([{ pfil: 'a.mp3' }, { pfil: 'b.mp3' }]))
    writeFileSync(join(dir, 'Subcrates', 'Good.crate'), crate(['b.mp3']))
    const later = new Date(Date.now() + 60_000)
    utimesSync(join(dir, 'database V2'), later, later)
    utimesSync(join(dir, 'Subcrates', 'Good.crate'), later, later)
    const library = readSeratoLibrary(roots)
    expect(library.tracks.map((t) => t.file)).toEqual(['/a.mp3', '/b.mp3'])
    expect(seratoPlaylist(library, 'Good', NOW).map((e) => e.path)).toEqual(['/b.mp3'])
  })

  it('parses a file again when only its size changed, as a copy that keeps the time does', () => {
    const base = mkdtempSync(join(tmpdir(), 'surco-serato-library-'))
    const dir = seratoFolder(join(base, 'Music'), [{ pfil: 'a.mp3' }])
    const roots = seratoLibraryRoots(base, [])
    const at = new Date(2026, 0, 1)
    utimesSync(join(dir, 'database V2'), at, at)
    readSeratoLibrary(roots)
    writeFileSync(join(dir, 'database V2'), database([{ pfil: 'a.mp3' }, { pfil: 'b.mp3' }]))
    utimesSync(join(dir, 'database V2'), at, at)
    expect(readSeratoLibrary(roots).tracks.map((t) => t.file)).toEqual(['/a.mp3', '/b.mp3'])
  })
})

describe('a Serato library that cannot be read whole', () => {
  it('names the library whose database was cut short and still shows the tab what it could read', () => {
    const base = mkdtempSync(join(tmpdir(), 'surco-serato-library-'))
    const dir = seratoFolder(join(base, 'Music'), [{ pfil: 'a.mp3' }, { pfil: 'b.mp3' }])
    const whole = database([{ pfil: 'a.mp3' }, { pfil: 'b.mp3' }])
    writeFileSync(join(dir, 'database V2'), whole.subarray(0, whole.length - 3))
    const library = readSeratoLibrary(seratoLibraryRoots(base, []))
    expect(library.unreadable).toEqual([dir])
    expect(library.tracks.map((t) => t.file)).toEqual(['/a.mp3'])
  })

  it('names the library whose database is there but cannot be read', () => {
    const base = mkdtempSync(join(tmpdir(), 'surco-serato-library-'))
    const dir = join(base, 'Music', '_Serato_')
    mkdirSync(join(dir, 'database V2'), { recursive: true })
    expect(readSeratoLibrary(seratoLibraryRoots(base, [])).unreadable).toEqual([dir])
  })

  it('reads a folder with no database, or a drive unplugged since, as no library at all', () => {
    const { drive, roots } = twoLibraries()
    rmSync(drive, { recursive: true })
    const base = mkdtempSync(join(tmpdir(), 'surco-serato-library-'))
    mkdirSync(join(base, 'Music', '_Serato_'), { recursive: true })
    expect(readSeratoLibrary([...roots, ...seratoLibraryRoots(base, [])]).unreadable).toEqual([])
  })
})
