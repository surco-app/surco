import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
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
  virtualdjDriveRoots,
  virtualdjHomeDir,
  virtualdjLibraryRoots,
  virtualdjMembership,
  virtualdjPathOf,
  virtualdjPlaylist,
  virtualdjRecentCount,
  virtualdjRootLabel,
  virtualdjStoredPath,
  virtualdjTrackCount,
  virtualdjTree,
  virtualdjWindowsRoots,
} from './virtualdjLibrary'

const fixture = join(__dirname, 'virtualdjFixtures')
const NOW = new Date(2026, 10, 11, 12)
const DAY = 24 * 3600
const SECOND = new Date(2026, 0, 1)
const daysAgo = (days: number) => Math.floor(NOW.getTime() / 1000) - days * DAY

const local = (dir: string) => [{ dir, root: '/' }]

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
    expect(virtualdjTree(readVirtualdjLibrary(local(fixture)))).toEqual([
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
    expect(virtualdjTrackCount(readVirtualdjLibrary(local(fixture)))).toBe(6)
  })

  it('lists the collection as title, artist and content id for matching a pasted tracklist', () => {
    const collection = virtualdjCollection(readVirtualdjLibrary(local(fixture)))
    expect(collection).toHaveLength(6)
    expect(collection).toContainEqual({
      contentId: 'virtualdj:/Music/Serato Pruebas/Pray.flac',
      path: '/Music/Serato Pruebas/Pray.flac',
      title: 'Pray (W.I.P. In The Church Mix)',
      artist: 'Tina Cousins',
    })
  })

  it('gives a list its tracks in the order of the panel, each one a VirtualDJ track with its bpm and key', () => {
    const entries = virtualdjPlaylist(readVirtualdjLibrary(local(fixture)), 'Surco prueba')
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
      linkId: '1:%2FMusic%2FSerato%20Pruebas%2FPray.flac',
    })
  })

  it('opens a list inside a folder by its nested id', () => {
    expect(
      virtualdjPlaylist(readVirtualdjLibrary(local(fixture)), 'Carpeta/Dentro').map((e) => e.path),
    ).toEqual(['/Music/Serato Pruebas/Pray.mp3'])
  })

  it('opens a folder or an unknown id as an empty list, not an error', () => {
    const lib = readVirtualdjLibrary(local(fixture))
    expect(virtualdjPlaylist(lib, 'Carpeta')).toEqual([])
    expect(virtualdjPlaylist(lib, 'Nope')).toEqual([])
  })

  it('keeps a list row whose song is missing from the database, with no bpm or key to show', () => {
    const [row] = virtualdjPlaylist(readVirtualdjLibrary(local(fixture)), 'Surco escrita')
    expect(row).toEqual({
      path: '/Music/VirtualDJ Pruebas/Pray.flac',
      separator: false,
      meta: {},
      contentId: 'virtualdj:/Music/VirtualDJ Pruebas/Pray.flac',
      linkId: '0:%2FMusic%2FVirtualDJ%20Pruebas%2FPray.flac',
    })
  })

  it('names a list row by the database song path when the list wrote it in another Unicode form', () => {
    const nfc = '/Music/Café.mp3'
    const nfd = '/Music/Café.mp3'
    const lib = readVirtualdjLibrary(local(library([song(nfc)], { L: [nfd] })))
    expect(virtualdjPlaylist(lib, 'L')).toEqual([
      {
        path: nfd,
        separator: false,
        meta: { bpm: '120', key: '8A' },
        contentId: `virtualdj:${nfc}`,
        linkId: `0:${encodeURIComponent(nfd)}`,
      },
    ])
  })

  it('lists in Recently added only what VirtualDJ first saw in the last 30 days, newest first', () => {
    const lib = readVirtualdjLibrary(
      local(
        library([
          song('/old.mp3', daysAgo(90)),
          song('/a.mp3', daysAgo(3)),
          song('/b.mp3', daysAgo(1)),
          song('/never.mp3'),
        ]),
      ),
    )
    expect(virtualdjRecentCount(lib, NOW)).toBe(2)
    expect(virtualdjPlaylist(lib, RECENTLY_ADDED_ID, NOW).map((e) => e.path)).toEqual([
      '/b.mp3',
      '/a.mp3',
    ])
  })

  it('lists All tracks newest first, keeping the database order among songs seen at the same time', () => {
    const lib = readVirtualdjLibrary(
      local(
        library([
          song('/x.mp3'),
          song('/old.mp3', daysAgo(90)),
          song('/y.mp3'),
          song('/new.mp3', daysAgo(1)),
        ]),
      ),
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
    const lib = readVirtualdjLibrary(local(fixture))
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
      virtualdjMembership(readVirtualdjLibrary(local(library([song(nfc)], { L: [nfc] }))), [nfd]),
    ).toEqual({ [nfd]: ['L'] })
    expect(
      virtualdjMembership(readVirtualdjLibrary(local(library([song(nfc)], { L: [nfd] }))), [nfc]),
    ).toEqual({ [nfc]: ['L'] })
  })

  it('reads a folder without a database as an empty library, so the lists still show', () => {
    const lib = readVirtualdjLibrary(local(join(fixture, 'MyLists')))
    expect(virtualdjTrackCount(lib)).toBe(0)
    expect(virtualdjTree(lib)).toEqual([])
    const missing = readVirtualdjLibrary(local(join(tmpdir(), 'surco-vdj-nowhere')))
    expect(virtualdjTrackCount(missing)).toBe(0)
    expect(virtualdjTree(missing)).toEqual([])
  })

  it('parses the database once while the file stays the same, since VirtualDJ libraries get big', () => {
    const dir = copy()
    const file = join(dir, 'database.xml')
    readVirtualdjLibrary(local(dir))
    reads.length = 0
    readVirtualdjLibrary(local(dir))
    expect(reads.filter((r) => r === file)).toEqual([])
  })

  it('parses the database again once VirtualDJ rewrote it', () => {
    const dir = library([song('/a.mp3')])
    const file = join(dir, 'database.xml')
    utimesSync(file, SECOND, SECOND)
    expect(virtualdjCollection(readVirtualdjLibrary(local(dir)))[0].path).toBe('/a.mp3')
    writeFileSync(file, readFileSync(file, 'utf8').replaceAll('/a.mp3', '/b.mp3'))
    utimesSync(file, SECOND, new Date(SECOND.getTime() + 5000))
    expect(virtualdjCollection(readVirtualdjLibrary(local(dir)))[0].path).toBe('/b.mp3')
  })

  it('parses the database again when only its size changed, as a copy that keeps the time does', () => {
    const dir = library([song('/a.mp3')])
    const file = join(dir, 'database.xml')
    utimesSync(file, SECOND, SECOND)
    expect(virtualdjTrackCount(readVirtualdjLibrary(local(dir)))).toBe(1)
    writeFileSync(
      file,
      `<VirtualDJ_Database>${song('/a.mp3')}${song('/b.mp3')}</VirtualDJ_Database>`,
    )
    utimesSync(file, SECOND, SECOND)
    expect(virtualdjTrackCount(readVirtualdjLibrary(local(dir)))).toBe(2)
  })
})

function drives(names: Record<string, string[] | null>): { home: string; volumes: string } {
  const base = mkdtempSync(join(tmpdir(), 'surco-vdj-drives-'))
  const home = join(base, 'VirtualDJ')
  mkdirSync(home)
  writeFileSync(
    join(home, 'database.xml'),
    `<VirtualDJ_Database>${song('/Music/a.mp3')}</VirtualDJ_Database>`,
  )
  const volumes = join(base, 'Volumes')
  for (const [name, songs] of Object.entries(names)) {
    mkdirSync(join(volumes, name), { recursive: true })
    if (songs === null) continue
    mkdirSync(join(volumes, name, 'VirtualDJ'))
    writeFileSync(
      join(volumes, name, 'VirtualDJ', 'database.xml'),
      `<VirtualDJ_Database>\r\n${songs.map((p) => song(p)).join('')}</VirtualDJ_Database>\r\n`,
    )
  }
  return { home, volumes }
}

describe('virtualdjLibraryRoots', () => {
  it("adds the VirtualDJ folder of each mounted drive, since VirtualDJ keeps a drive's tracks only there", () => {
    const { home, volumes } = drives({ Public: [], Bare: null })
    expect(virtualdjLibraryRoots(home, volumes)).toEqual([
      { dir: home, root: '/' },
      { dir: join(volumes, 'Public', 'VirtualDJ'), root: join(volumes, 'Public') },
    ])
  })

  it('never makes a VirtualDJ folder on a drive VirtualDJ has not used', () => {
    const { home, volumes } = drives({ Bare: null })
    virtualdjLibraryRoots(home, volumes)
    expect(existsSync(join(volumes, 'Bare', 'VirtualDJ'))).toBe(false)
  })

  it('drops a drive once it is unplugged', () => {
    const { home, volumes } = drives({ Public: [] })
    rmSync(join(volumes, 'Public'), { recursive: true })
    expect(virtualdjLibraryRoots(home, volumes)).toEqual([{ dir: home, root: '/' }])
  })

  it('reads only the drives when no VirtualDJ folder is set up at home', () => {
    const { volumes } = drives({ Public: [] })
    expect(virtualdjLibraryRoots(join(volumes, 'nowhere'), volumes)).toEqual([
      { dir: join(volumes, 'Public', 'VirtualDJ'), root: join(volumes, 'Public') },
    ])
  })
})

describe("a drive's VirtualDJ database", () => {
  it('reads the drive folder once, as that drive, when Settings points VirtualDJ at it', () => {
    const { volumes } = drives({ Public: ['D:/Musica/a.flac'] })
    const setting = join(volumes, 'Public', 'VirtualDJ')
    mkdirSync(join(setting, 'MyLists'))
    writeFileSync(join(setting, 'MyLists', 'order'), 'Gigs')
    writeFileSync(
      join(setting, 'MyLists', 'Gigs.vdjfolder'),
      '<VirtualFolder>\r\n<song path="D:/Musica/a.flac" idx="0" />\r\n</VirtualFolder>',
    )
    const roots = virtualdjLibraryRoots(`${setting}/`, volumes)
    expect(roots).toHaveLength(1)
    const lib = readVirtualdjLibrary(roots)
    expect(virtualdjCollection(lib).map((t) => t.path)).toEqual([
      join(volumes, 'Public', 'Musica', 'a.flac'),
    ])
    expect(virtualdjTree(lib).map((n) => n.name)).toEqual(['Gigs'])
  })

  it('translates a database by the root it is read as, whatever root read it before', () => {
    const { volumes } = drives({ Public: ['D:/Musica/a.flac'] })
    const dir = join(volumes, 'Public', 'VirtualDJ')
    readVirtualdjLibrary([{ dir, root: '/' }])
    const lib = readVirtualdjLibrary([{ dir, root: join(volumes, 'Public') }])
    expect(virtualdjCollection(lib).map((t) => t.path)).toEqual([
      join(volumes, 'Public', 'Musica', 'a.flac'),
    ])
  })

  it('reads its drive letter paths as files on that drive, with the entities decoded', () => {
    const { home, volumes } = drives({ Public: ['D:/Musica/It&apos;s Mine.flac', 'E:/Otra/b.mp3'] })
    const lib = readVirtualdjLibrary(virtualdjLibraryRoots(home, volumes))
    expect(virtualdjCollection(lib).map((t) => t.contentId)).toEqual([
      `virtualdj:${join(volumes, 'Public', 'Otra', 'b.mp3')}`,
      `virtualdj:${join(volumes, 'Public', 'Musica', "It's Mine.flac")}`,
      'virtualdj:/Music/a.mp3',
    ])
  })

  it('answers that a drive file is used and lists it in All tracks', () => {
    const { home, volumes } = drives({ Public: ['D:/Musica/x.flac'] })
    const lib = readVirtualdjLibrary(virtualdjLibraryRoots(home, volumes))
    const file = join(volumes, 'Public', 'Musica', 'x.flac')
    expect(virtualdjPlaylist(lib, ALL_TRACKS_ID).map((e) => e.path)).toContain(file)
    expect(virtualdjMembership(lib, [file])).toEqual({ [file]: [] })
  })
})

describe('virtualdjStoredPath', () => {
  const root = { dir: '/Volumes/Public/VirtualDJ', root: '/Volumes/Public' }

  it("spells a drive file with the letter that drive's database already uses", () => {
    const xml = '<Song FilePath="F:/Musica/a.mp3" />'
    expect(virtualdjStoredPath(root, "/Volumes/Public/Musica/It's.flac", xml)).toBe(
      "F:/Musica/It's.flac",
    )
  })

  it('spells it with D: when that database has no drive file yet, as VirtualDJ did for the one measured', () => {
    expect(virtualdjStoredPath(root, '/Volumes/Public/Musica/a.mp3', '<VirtualDJ_Database>')).toBe(
      'D:/Musica/a.mp3',
    )
  })

  it('keeps a file of the home database as it is', () => {
    expect(virtualdjStoredPath({ dir: '/x', root: '/' }, '/Music/a.mp3', '')).toBe('/Music/a.mp3')
  })
})

describe('VirtualDJ on Windows, not measured on a real Windows yet', () => {
  const folders = {
    home: 'C:\\Users\\dj',
    documents: 'C:\\Users\\dj\\Documents',
    localAppData: 'C:\\Users\\dj\\AppData\\Local',
  }
  const documents = 'C:\\Users\\dj\\Documents\\VirtualDJ'
  const localAppData = 'C:\\Users\\dj\\AppData\\Local\\VirtualDJ'
  const home = { dir: documents, root: '/' }
  const drive = { dir: 'E:\\VirtualDJ', root: 'E:\\' }

  it('looks for the library in Documents, where VirtualDJ 8 keeps it on Windows', () => {
    expect(virtualdjHomeDir('win32', folders, () => true)).toBe(documents)
    expect(virtualdjHomeDir('win32', folders, () => false)).toBe(documents)
  })

  it('falls back to the local application data folder only when Documents holds no database', () => {
    const exists = (path: string) => path === `${localAppData}\\database.xml`
    expect(virtualdjHomeDir('win32', folders, exists)).toBe(localAppData)
  })

  it('keeps the measured macOS folder on a Mac', () => {
    expect(virtualdjHomeDir('darwin', { ...folders, home: '/Users/dj' }, () => false)).toBe(
      '/Users/dj/Library/Application Support/VirtualDJ',
    )
  })

  it('reads a home path with either separator as the same Windows file', () => {
    expect(virtualdjPathOf(home, 'C:/Music/a.mp3')).toBe('C:\\Music\\a.mp3')
    expect(virtualdjPathOf(home, 'C:\\Music\\a.mp3')).toBe('C:\\Music\\a.mp3')
  })

  it("reads a drive database's own letter as absolute and another letter as relative to the drive", () => {
    expect(virtualdjPathOf(drive, 'E:\\Music\\a.mp3')).toBe('E:\\Music\\a.mp3')
    expect(virtualdjPathOf(drive, 'e:/Music/a.mp3')).toBe('E:\\Music\\a.mp3')
    expect(virtualdjPathOf(drive, 'D:/Music/a.mp3')).toBe('E:\\Music\\a.mp3')
  })

  it('writes a new home path with the separator the database already uses, and a backslash when it has none', () => {
    const slashed = '<Song FilePath="C:/Music/a.mp3" />'
    expect(virtualdjStoredPath(home, 'C:\\Music\\new.mp3', slashed)).toBe('C:/Music/new.mp3')
    expect(virtualdjStoredPath(home, 'C:/Music/new.mp3', '<VirtualDJ_Database>')).toBe(
      'C:\\Music\\new.mp3',
    )
  })

  it("writes a new drive path with the letter and separator that drive's database already uses", () => {
    const file = 'E:\\Music\\new.mp3'
    expect(virtualdjStoredPath(drive, file, '<Song FilePath="D:/Old/a.mp3" />')).toBe(
      'D:/Music/new.mp3',
    )
    expect(virtualdjStoredPath(drive, file, '<Song FilePath="E:\\Old\\a.mp3" />')).toBe(
      'E:\\Music\\new.mp3',
    )
    expect(virtualdjStoredPath(drive, file, '<VirtualDJ_Database>')).toBe('E:\\Music\\new.mp3')
  })

  it('names the copies of a drive database after its letter, since a drive root has no folder name', () => {
    expect(virtualdjRootLabel(drive)).toBe('E')
    expect(virtualdjRootLabel(home)).toBe('Local')
    expect(virtualdjRootLabel({ dir: '/Volumes/Public/VirtualDJ', root: '/Volumes/Public' })).toBe(
      'Public',
    )
  })

  it('looks for a VirtualDJ folder on every drive it is given, keeping only those VirtualDJ used', () => {
    const base = mkdtempSync(join(tmpdir(), 'surco-vdj-letters-'))
    const [c, e, f] = ['C', 'E', 'F'].map((l) => join(base, l))
    for (const d of [c, e, f]) mkdirSync(d)
    mkdirSync(join(c, 'Documents', 'VirtualDJ'), { recursive: true })
    writeFileSync(join(c, 'Documents', 'VirtualDJ', 'database.xml'), '<VirtualDJ_Database />')
    mkdirSync(join(e, 'VirtualDJ'))
    writeFileSync(join(e, 'VirtualDJ', 'database.xml'), '<VirtualDJ_Database />')
    expect(virtualdjDriveRoots(join(c, 'Documents', 'VirtualDJ'), [c, e, f])).toEqual([
      { dir: join(c, 'Documents', 'VirtualDJ'), root: '/' },
      { dir: join(e, 'VirtualDJ'), root: e },
    ])
  })

  it('matches list rows and songs whatever separator or letter case each one uses', () => {
    const dir = library([song('C:/Music/a.mp3'), song('C:\\Music\\b.mp3')], {
      Gigs: ['c:\\Music\\a.mp3'],
    })
    const lib = readVirtualdjLibrary(local(dir))
    expect(virtualdjCollection(lib).map((t) => t.path)).toEqual([
      'C:\\Music\\b.mp3',
      'C:\\Music\\a.mp3',
    ])
    const [entry] = virtualdjPlaylist(lib, 'Gigs')
    expect(entry.contentId).toBe('virtualdj:C:\\Music\\a.mp3')
    expect(entry.meta.bpm).toBe('120')
    expect(virtualdjMembership(lib, ['C:\\Music\\a.mp3'])).toEqual({
      'C:\\Music\\a.mp3': ['Gigs'],
    })
  })

  it('looks at no drive letter while the VirtualDJ folder holds no database, so a Windows user without VirtualDJ pays nothing', () => {
    const drives = vi.fn(() => ['E:\\'])
    const dir = mkdtempSync(join(tmpdir(), 'surco-vdj-nohome-'))
    expect(virtualdjWindowsRoots(dir, drives)).toEqual([])
    expect(drives).not.toHaveBeenCalled()
  })

  it('looks at every drive letter once the VirtualDJ folder holds its database', () => {
    const base = mkdtempSync(join(tmpdir(), 'surco-vdj-winroots-'))
    const home = join(base, 'Documents', 'VirtualDJ')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'database.xml'), '<VirtualDJ_Database />')
    const e = join(base, 'E')
    mkdirSync(join(e, 'VirtualDJ'), { recursive: true })
    writeFileSync(join(e, 'VirtualDJ', 'database.xml'), '<VirtualDJ_Database />')
    expect(virtualdjWindowsRoots(home, () => [e])).toEqual([
      { dir: home, root: '/' },
      { dir: join(e, 'VirtualDJ'), root: e },
    ])
  })
})
