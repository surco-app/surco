import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RekordboxRepoint } from './rekordboxBatch'
import { createRekordboxQueue } from './rekordboxQueue'
import { applyVirtualdjBatch } from './virtualdjBatch'
import { parseVirtualdjDatabase } from './virtualdjDatabase'
import { readVirtualdjLibrary, virtualdjLibraryRoots, virtualdjPlaylist } from './virtualdjLibrary'
import { repointVirtualdjTracks } from './virtualdjTrackWrite'

const fixture = join(__dirname, 'virtualdjFixtures')
const FIXTURE_XML = readFileSync(join(fixture, 'database.xml'), 'utf8')
const FROM = '/Music/Serato Pruebas/Pray.mp3'
const CLOSE = '</VirtualDJ_Database>\r\n'

function songBlock(xml: string, path: string): string {
  const at = xml.indexOf(`<Song FilePath="${path}"`)
  return xml.slice(at, xml.indexOf('</Song>', at))
}

function library() {
  const base = mkdtempSync(join(tmpdir(), 'surco-vdj-repoint-'))
  const dir = join(base, 'VirtualDJ')
  cpSync(fixture, dir, { recursive: true })
  const volumes = join(base, 'Volumes')
  mkdirSync(volumes)
  const music = join(base, 'Music')
  mkdirSync(music)
  const backupDir = join(base, 'virtualdj-backups')
  let open = false
  const roots = () => virtualdjLibraryRoots(dir, volumes)
  const deps = {
    backupDir,
    roots,
    virtualdjOpen: vi.fn(async () => open),
    lengthOf: vi.fn(async () => 100),
  }
  const track = (name: string, bytes = 'aiffdata') => {
    const file = join(music, name)
    writeFileSync(file, bytes)
    return file
  }
  const database = () => readFileSync(join(dir, 'database.xml'), 'utf8')
  const lists = join(dir, 'MyLists')
  const list = (id: string) =>
    virtualdjPlaylist(readVirtualdjLibrary(roots()), id).map((entry) => entry.path)
  const copies = (sub = '') => {
    const at = join(backupDir, sub)
    return existsSync(at) ? readdirSync(at).filter((n) => n !== 'lists') : []
  }
  return {
    base,
    dir,
    volumes,
    deps,
    track,
    database,
    lists,
    list,
    copies,
    roots,
    setOpen: (v: boolean) => {
      open = v
    },
  }
}

const trimmed = (to: string): RekordboxRepoint => ({
  from: FROM,
  to,
  engineShift: { trimmedMs: 10000, sampleCount: 4410000 },
})

describe('repointVirtualdjTracks', () => {
  it('moves the song to the new file with its size and length, its cues and grid shifted by the trim and the cues past the end dropped', async () => {
    const lib = library()
    const to = lib.track('Pray.aiff')
    expect(await repointVirtualdjTracks([trimmed(to)], lib.deps)).toEqual([{ written: true }])
    const xml = lib.database()
    expect(xml).not.toContain(`FilePath="${FROM}"`)
    expect(songBlock(xml, to).split('\r\n')).toEqual([
      `<Song FilePath="${to}" FileSize="8" Flag="268435456">`,
      '  <Tags Author="Tina Cousins" Title="Pray (W.I.P. In The Church Mix)" Genre="Electronic" Album="Pray" TrackNumber="01" Year="1998" Bpm="0.447761" Key="Ebm" Flag="1" />',
      '  <Infos SongLength="100.0" LastModified="1794400456" FirstSeen="1794393066" FirstPlay="1794393110" LastPlay="1794393110" PlayCount="1" Bitrate="320" Cover="16386" />',
      '  <Scan Version="801" Bpm="0.447778" Phase="47.559456" AltBpm="0.335828" Volume="1.317936" Key="Ebm" AudioSig="aXOIhoepmbqHh57WpqXLTkYN" Flag="32768" />',
      '  <Poi Name="Surco" Pos="19.973878" Num="1" Color="4278190335" Type="cue" />',
      '  <Poi Name="2" Pos="47.626667" Num="2" Type="cue" />',
      '  <Poi Pos="48.014331" Type="automix" Point="cutStart" />',
      '  <Poi Pos="48.454512" Type="automix" Point="tempoStart" />',
      '  <Poi Name="3" Pos="87.0" Num="3" Type="cue" />',
      ' ',
    ])
    const others = (x: string) =>
      parseVirtualdjDatabase(x).filter((s) => s.path !== FROM && s.path !== to)
    expect(others(xml)).toEqual(others(FIXTURE_XML))
  })

  it('points every list row of the old file at the new one, keeping the rest of each row and each list', async () => {
    const lib = library()
    const to = lib.track('Pray.aiff')
    const dentro = readFileSync(join(lib.lists, 'Carpeta.subfolders', 'Dentro.vdjfolder'), 'utf8')
    await repointVirtualdjTracks([trimmed(to)], lib.deps)
    expect(lib.list('Surco prueba')).toEqual([
      to,
      '/Music/Serato Pruebas/Pray.flac',
      '/Music/VirtualDJ Pruebas/Pray.aiff',
      '/Music/VirtualDJ Pruebas/Pray.m4a',
      '/Music/VirtualDJ Pruebas/Pray.wav',
    ])
    expect(readFileSync(join(lib.lists, 'Carpeta.subfolders', 'Dentro.vdjfolder'), 'utf8')).toBe(
      dentro.replace(`path="${FROM}" size="17138984"`, `path="${to}" size="8"`),
    )
    expect(readFileSync(join(lib.lists, 'Surco escrita.vdjfolder'))).toEqual(
      readFileSync(join(fixture, 'MyLists', 'Surco escrita.vdjfolder')),
    )
  })

  it('keeps the database and the lists copies apart, one of each for the move', async () => {
    const lib = library()
    await repointVirtualdjTracks([trimmed(lib.track('Pray.aiff'))], lib.deps)
    expect(lib.copies()).toHaveLength(1)
    expect(lib.copies('lists')).toHaveLength(1)
  })

  it('moves the cues only once when a rewrite on the same path is applied again', async () => {
    const lib = library()
    const path = join(lib.base, 'Music', 'Pray.mp3')
    writeFileSync(
      join(lib.dir, 'database.xml'),
      FIXTURE_XML.replace(`FilePath="${FROM}"`, `FilePath="${path}"`),
    )
    lib.track('Pray.mp3', 'rewritten')
    const repoint = { ...trimmed(path), from: path, fromBytes: 17138984 }
    expect(await repointVirtualdjTracks([repoint], lib.deps)).toEqual([{ written: true }])
    const once = lib.database()
    expect(await repointVirtualdjTracks([repoint], lib.deps)).toEqual([
      { written: false, reason: 'no-match' },
    ])
    expect(lib.database()).toBe(once)
    expect(songBlock(once, path)).toContain('Pos="19.973878" Num="1"')
  })

  it('leaves both songs as they are when the new file already has its own song', async () => {
    const lib = library()
    const to = '/Music/VirtualDJ Pruebas/Pray.wav'
    const result = await repointVirtualdjTracks(
      [{ from: FROM, to, engineShift: { trimmedMs: 0 } }],
      { ...lib.deps, roots: () => [{ dir: lib.dir, root: '/' }] },
    )
    expect(result).toEqual([{ written: false, reason: 'output-missing' }])
    expect(lib.database()).toBe(FIXTURE_XML)
    const there = lib.track('Pray.wav')
    writeFileSync(
      join(lib.dir, 'database.xml'),
      FIXTURE_XML.replace('FilePath="/Music/VirtualDJ Pruebas/Pray.wav"', `FilePath="${there}"`),
    )
    const before = lib.database()
    expect(await repointVirtualdjTracks([{ from: FROM, to: there }], lib.deps)).toEqual([
      { written: false, reason: 'song-taken' },
    ])
    expect(lib.database()).toBe(before)
  })

  it('names a length it cannot write as the reason, not a song already on the new file', async () => {
    const lib = library()
    const to = lib.track('Pray.aiff')
    const before = lib.database()
    expect(
      await repointVirtualdjTracks([trimmed(to)], {
        ...lib.deps,
        lengthOf: async () => Number.NaN,
      }),
    ).toEqual([{ written: false, reason: 'unwritable' }])
    expect(lib.database()).toBe(before)
  })

  it('moves a song on a drive inside that drive database, with the drive letter', async () => {
    const lib = library()
    const volume = join(lib.volumes, 'Public')
    mkdirSync(join(volume, 'VirtualDJ'), { recursive: true })
    mkdirSync(join(volume, 'Musica'))
    const driveXml = `<?xml version="1.0" encoding="UTF-8"?>\r\n<VirtualDJ_Database Version="2026">\r\n <Song FilePath="E:/Musica/a.mp3" FileSize="3" Flag="268435456">\r\n  <Poi Pos="12.5" Num="1" Type="cue" />\r\n </Song>\r\n${CLOSE}`
    writeFileSync(join(volume, 'VirtualDJ', 'database.xml'), driveXml)
    const to = join(volume, 'Musica', 'a.aiff')
    writeFileSync(to, 'abcd')
    const home = lib.database()
    expect(
      await repointVirtualdjTracks(
        [{ from: join(volume, 'Musica', 'a.mp3'), to, engineShift: { trimmedMs: 2500 } }],
        lib.deps,
      ),
    ).toEqual([{ written: true }])
    expect(lib.database()).toBe(home)
    expect(readFileSync(join(volume, 'VirtualDJ', 'database.xml'), 'utf8')).toBe(
      driveXml
        .replace(
          'FilePath="E:/Musica/a.mp3" FileSize="3"',
          'FilePath="E:/Musica/a.aiff" FileSize="4"',
        )
        .replace('Pos="12.5"', 'Pos="10.0"'),
    )
  })

  it('waits while VirtualDJ is open and moves the song and its rows once VirtualDJ closes', async () => {
    const lib = library()
    const to = lib.track('Pray.aiff')
    const queue = createRekordboxQueue({
      store: { read: () => null, write: () => {}, setAside: () => {} },
      collection: () => lib.dir,
      applyBatch: (_c, ops, ensureClosed, stillQueued) =>
        applyVirtualdjBatch(ops, { ...lib.deps, ensureClosed, stillQueued }),
      repoint: (_c, list) => repointVirtualdjTracks(list, lib.deps),
      nodeStamps: async () => ({}),
      onChange: () => {},
      addsTracks: false,
    })
    queue.enqueue([], [trimmed(to)])
    lib.setOpen(true)
    expect(await queue.apply(async () => !(await lib.deps.virtualdjOpen()))).toEqual({
      status: 'refused',
      reason: 'cancelled',
    })
    expect(lib.database()).toBe(FIXTURE_XML)
    lib.setOpen(false)
    expect(await queue.apply(async () => true)).toMatchObject({ status: 'applied', tracks: 1 })
    expect(lib.database()).toContain(`FilePath="${to}"`)
    expect(lib.list('Carpeta/Dentro')).toEqual([to])
    expect(await queue.apply(async () => true)).toEqual({ status: 'empty' })
  })
})
