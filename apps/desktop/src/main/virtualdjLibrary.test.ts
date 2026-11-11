import { cpSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
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
import {
  readVirtualdjLibrary,
  virtualdjCollection,
  virtualdjMembership,
  virtualdjPlaylist,
  virtualdjRecentCount,
  virtualdjTrackCount,
  virtualdjTree,
} from './virtualdjLibrary'

const fixture = join(__dirname, 'virtualdjFixtures')
const NOW = new Date(2026, 10, 11, 12)
const DAY = 24 * 3600
const SECOND = new Date(2026, 0, 1)
const daysAgo = (days: number) => Math.floor(NOW.getTime() / 1000) - days * DAY

function copy(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'surco-vdj-library-')), 'VirtualDJ')
  cpSync(fixture, dir, { recursive: true })
  return dir
}

const song = (path: string, firstSeen?: number, extra = '') =>
  `<Song FilePath="${path}" FileSize="1">\r\n<Tags Author="A ${path}" Title="T ${path}" Bpm="0.5" Key="8A" />\r\n${
    firstSeen === undefined ? '' : `<Infos FirstSeen="${firstSeen}" />\r\n`
  }${extra}</Song>\r\n`

function library(songs: string[], lists: Record<string, string[]> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'surco-vdj-made-'))
  writeFileSync(
    join(dir, 'database.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\r\n<VirtualDJ_Database Version="2026">\r\n${songs.join('')}</VirtualDJ_Database>\r\n`,
  )
  const mylists = join(dir, 'MyLists')
  mkdirSync(mylists)
  writeFileSync(join(mylists, 'order'), Object.keys(lists).join('\n'))
  for (const [name, paths] of Object.entries(lists))
    writeFileSync(
      join(mylists, `${name}.vdjfolder`),
      `<VirtualFolder>\r\n${paths.map((p, i) => `<song path="${p}" idx="${i}" />`).join('\r\n')}\r\n</VirtualFolder>`,
    )
  return dir
}

describe('readVirtualdjLibrary', () => {
  it('shows MyLists as VirtualDJ does, folders holding their lists and every list with its count', () => {
    expect(virtualdjTree(readVirtualdjLibrary(fixture))).toEqual([
      {
        id: 'Carpeta',
        name: 'Carpeta',
        kind: 'folder',
        count: 1,
        children: [{ id: 'Carpeta/Dentro', name: 'Dentro', kind: 'playlist', count: 1 }],
      },
      { id: 'Surco prueba', name: 'Surco prueba', kind: 'playlist', count: 5 },
      { id: 'Surco escrita', name: 'Surco escrita', kind: 'playlist', count: 1 },
    ])
  })

  it('counts every song of the database in All tracks', () => {
    expect(virtualdjTrackCount(readVirtualdjLibrary(fixture))).toBe(6)
  })

  it('lists the collection as title, artist and content id for matching a pasted tracklist', () => {
    const collection = virtualdjCollection(readVirtualdjLibrary(fixture))
    expect(collection).toHaveLength(6)
    expect(collection).toContainEqual({
      contentId: 'virtualdj:/Music/Serato Pruebas/Pray.flac',
      path: '/Music/Serato Pruebas/Pray.flac',
      title: 'Pray (W.I.P. In The Church Mix)',
      artist: 'Tina Cousins',
    })
  })

  it('gives a list its tracks in the order of the panel, each one a VirtualDJ track with its bpm and key', () => {
    const entries = virtualdjPlaylist(readVirtualdjLibrary(fixture), 'Surco prueba')
    expect(entries.map((e) => e.path)).toEqual([
      '/Music/Serato Pruebas/Pray.mp3',
      '/Music/Serato Pruebas/Pray.flac',
      '/Music/VirtualDJ Pruebas/Pray.aiff',
      '/Music/VirtualDJ Pruebas/Pray.m4a',
      '/Music/VirtualDJ Pruebas/Pray.wav',
    ])
    expect(entries[1]).toEqual({
      path: '/Music/Serato Pruebas/Pray.flac',
      separator: false,
      meta: { bpm: '133.99', key: 'Ebm' },
      contentId: 'virtualdj:/Music/Serato Pruebas/Pray.flac',
    })
  })

  it('opens a list inside a folder by its nested id', () => {
    expect(
      virtualdjPlaylist(readVirtualdjLibrary(fixture), 'Carpeta/Dentro').map((e) => e.path),
    ).toEqual(['/Music/Serato Pruebas/Pray.mp3'])
  })

  it('opens a folder or an unknown id as an empty list, not an error', () => {
    const lib = readVirtualdjLibrary(fixture)
    expect(virtualdjPlaylist(lib, 'Carpeta')).toEqual([])
    expect(virtualdjPlaylist(lib, 'Nope')).toEqual([])
  })

  it('keeps a list row whose song is missing from the database, with no bpm or key to show', () => {
    const [row] = virtualdjPlaylist(readVirtualdjLibrary(fixture), 'Surco escrita')
    expect(row).toEqual({
      path: '/Music/VirtualDJ Pruebas/Pray.flac',
      separator: false,
      meta: {},
      contentId: 'virtualdj:/Music/VirtualDJ Pruebas/Pray.flac',
    })
  })

  it('names a list row by the database song path when the list wrote it in another Unicode form', () => {
    const nfc = '/Music/Café.mp3'
    const nfd = '/Music/Café.mp3'
    const lib = readVirtualdjLibrary(library([song(nfc)], { L: [nfd] }))
    expect(virtualdjPlaylist(lib, 'L')).toEqual([
      {
        path: nfd,
        separator: false,
        meta: { bpm: '120', key: '8A' },
        contentId: `virtualdj:${nfc}`,
      },
    ])
  })

  it('lists in Recently added only what VirtualDJ first saw in the last 30 days, newest first', () => {
    const lib = readVirtualdjLibrary(
      library([
        song('/old.mp3', daysAgo(90)),
        song('/a.mp3', daysAgo(3)),
        song('/b.mp3', daysAgo(1)),
        song('/never.mp3'),
      ]),
    )
    expect(virtualdjRecentCount(lib, NOW)).toBe(2)
    expect(virtualdjPlaylist(lib, RECENTLY_ADDED_ID, NOW).map((e) => e.path)).toEqual([
      '/b.mp3',
      '/a.mp3',
    ])
  })

  it('lists All tracks newest first, keeping the database order among songs seen at the same time', () => {
    const lib = readVirtualdjLibrary(
      library([
        song('/x.mp3'),
        song('/old.mp3', daysAgo(90)),
        song('/y.mp3'),
        song('/new.mp3', daysAgo(1)),
      ]),
    )
    expect(virtualdjPlaylist(lib, ALL_TRACKS_ID, NOW).map((e) => e.path)).toEqual([
      '/new.mp3',
      '/old.mp3',
      '/y.mp3',
      '/x.mp3',
    ])
    expect(virtualdjCollection(lib).map((t) => t.path)).toEqual([
      '/new.mp3',
      '/old.mp3',
      '/y.mp3',
      '/x.mp3',
    ])
  })

  it('says which lists hold each file, with a file only in the database holding none', () => {
    const lib = readVirtualdjLibrary(fixture)
    expect(
      virtualdjMembership(lib, [
        '/Music/Serato Pruebas/Pray.mp3',
        '/Music/VirtualDJ Pruebas/Pray.mp3',
        '/Music/VirtualDJ Pruebas/Pray.flac',
        '/Elsewhere/x.mp3',
      ]),
    ).toEqual({
      '/Music/Serato Pruebas/Pray.mp3': ['Carpeta/Dentro', 'Surco prueba'],
      '/Music/VirtualDJ Pruebas/Pray.mp3': [],
      '/Music/VirtualDJ Pruebas/Pray.flac': ['Surco escrita'],
    })
  })

  it('matches a file whose name macOS handed over decomposed', () => {
    const nfc = '/Music/Café.mp3'
    const nfd = '/Music/Café.mp3'
    expect(
      virtualdjMembership(readVirtualdjLibrary(library([song(nfc)], { L: [nfc] })), [nfd]),
    ).toEqual({ [nfd]: ['L'] })
    expect(
      virtualdjMembership(readVirtualdjLibrary(library([song(nfc)], { L: [nfd] })), [nfc]),
    ).toEqual({ [nfc]: ['L'] })
  })

  it('reads a folder without a database as an empty library, so the lists still show', () => {
    const lib = readVirtualdjLibrary(join(fixture, 'MyLists'))
    expect(virtualdjTrackCount(lib)).toBe(0)
    expect(virtualdjTree(lib)).toEqual([])
    const missing = readVirtualdjLibrary(join(tmpdir(), 'surco-vdj-nowhere'))
    expect(virtualdjTrackCount(missing)).toBe(0)
    expect(virtualdjTree(missing)).toEqual([])
  })

  it('parses the database once while the file stays the same, since VirtualDJ libraries get big', () => {
    const dir = copy()
    const file = join(dir, 'database.xml')
    readVirtualdjLibrary(dir)
    reads.length = 0
    readVirtualdjLibrary(dir)
    expect(reads.filter((r) => r === file)).toEqual([])
  })

  it('parses the database again once VirtualDJ rewrote it', () => {
    const dir = library([song('/a.mp3')])
    const file = join(dir, 'database.xml')
    utimesSync(file, SECOND, SECOND)
    expect(virtualdjCollection(readVirtualdjLibrary(dir))[0].path).toBe('/a.mp3')
    writeFileSync(file, readFileSync(file, 'utf8').replaceAll('/a.mp3', '/b.mp3'))
    utimesSync(file, SECOND, new Date(SECOND.getTime() + 5000))
    expect(virtualdjCollection(readVirtualdjLibrary(dir))[0].path).toBe('/b.mp3')
  })

  it('parses the database again when only its size changed, as a copy that keeps the time does', () => {
    const dir = library([song('/a.mp3')])
    const file = join(dir, 'database.xml')
    utimesSync(file, SECOND, SECOND)
    expect(virtualdjTrackCount(readVirtualdjLibrary(dir))).toBe(1)
    writeFileSync(
      file,
      `<VirtualDJ_Database>${song('/a.mp3')}${song('/b.mp3')}</VirtualDJ_Database>`,
    )
    utimesSync(file, SECOND, SECOND)
    expect(virtualdjTrackCount(readVirtualdjLibrary(dir))).toBe(2)
  })
})
