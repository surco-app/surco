import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALL_TRACKS_ID } from '../shared/allTracks'
import { RECENTLY_ADDED_ID } from '../shared/recentlyAdded'
import { concat, frame, track, utf16be } from './seratoDatabaseFixture'
import {
  readSeratoLibrary,
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
  it('nests subcrates under their parent and merges same-named crates across drives', () => {
    const library = readSeratoLibrary(twoLibraries().roots)
    expect(seratoTree(library)).toEqual([
      { id: 'Friday', name: 'Friday', kind: 'playlist', count: 1 },
      {
        id: 'House',
        name: 'House',
        kind: 'folder',
        count: 1,
        children: [{ id: 'House%%Deep', name: 'Deep', kind: 'playlist', count: 1 }],
      },
    ])
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
    const { drive, roots } = twoLibraries()
    const entries = seratoPlaylist(readSeratoLibrary(roots), 'House', NOW)
    expect(entries).toEqual([
      {
        path: '/Users/dj/Music/old.mp3',
        separator: false,
        meta: {},
        contentId: 'serato:/Users/dj/Music/old.mp3',
      },
      {
        path: '/Users/dj/Music/new.mp3',
        separator: false,
        meta: { bpm: '128', key: '8A' },
        contentId: 'serato:/Users/dj/Music/new.mp3',
      },
      {
        path: join(drive, 'Tracks/gig.flac'),
        separator: false,
        meta: {},
        contentId: `serato:${join(drive, 'Tracks/gig.flac')}`,
      },
    ])
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
})
