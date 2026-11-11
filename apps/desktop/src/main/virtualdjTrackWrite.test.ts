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
import type { RekordboxMeta } from './rekordboxMetadata'
import { createRekordboxQueue } from './rekordboxQueue'
import type { TrackOp } from './rekordboxQueueOps'
import { applyVirtualdjBatch } from './virtualdjBatch'
import { parseVirtualdjDatabase } from './virtualdjDatabase'
import { readVirtualdjLibrary, virtualdjLibraryRoots, virtualdjPlaylist } from './virtualdjLibrary'
import { virtualdjLibraryHas } from './virtualdjTrackWrite'

const fixture = join(__dirname, 'virtualdjFixtures')
const FIXTURE_XML = readFileSync(join(fixture, 'database.xml'), 'utf8')
const CLOSE = '</VirtualDJ_Database>\r\n'
const HELD = '/Music/VirtualDJ Pruebas/Pray.mp3'

const META: RekordboxMeta = {
  title: 'Plastic & Dreams',
  artist: 'Jaydee',
  album: 'Plastic Dreams',
  albumArtist: '',
  genre: 'House',
  label: 'R&S',
  remixer: '',
  comment: 'a comment',
  year: '1992',
  trackNumber: '1',
  discNumber: '',
}

function library() {
  const base = mkdtempSync(join(tmpdir(), 'surco-vdj-track-write-'))
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
    ensureClosed: vi.fn(async () => !open),
  }
  const track = (name: string, bytes = 'audio') => {
    const file = join(music, name)
    writeFileSync(file, bytes)
    return file
  }
  const drive = (name: string, xml: string) => {
    const volume = join(volumes, name)
    mkdirSync(join(volume, 'VirtualDJ'), { recursive: true })
    writeFileSync(join(volume, 'VirtualDJ', 'database.xml'), xml)
    return volume
  }
  const database = () => readFileSync(join(dir, 'database.xml'), 'utf8')
  const list = (id: string) =>
    virtualdjPlaylist(readVirtualdjLibrary(roots()), id).map((entry) => entry.path)
  const backups = (sub = '') => {
    const at = join(backupDir, sub)
    return existsSync(at) ? readdirSync(at).filter((n) => n !== 'lists') : []
  }
  return {
    dir,
    deps,
    track,
    drive,
    database,
    list,
    backups,
    roots,
    setOpen: (v: boolean) => {
      open = v
    },
  }
}

const added = (path: string, over: Partial<TrackOp> = {}): TrackOp => ({
  id: 'op1',
  kind: 'track',
  path,
  label: 'Plastic Dreams',
  facts: null,
  meta: META,
  wanted: [],
  known: [],
  stamps: {},
  add: true,
  ...over,
})

describe('applyVirtualdjBatch with a converted track', () => {
  it('adds it as a <Song> with its path, size and the four tags, and nothing VirtualDJ computes itself', async () => {
    const lib = library()
    const file = lib.track('Plastic Dreams.flac', 'flacdata')
    const result = await applyVirtualdjBatch([added(file)], lib.deps)
    expect(result).toMatchObject({
      ok: true,
      wrote: true,
      outcomes: [{ id: 'op1', applied: true }],
    })
    expect(lib.database()).toBe(
      `${FIXTURE_XML.slice(0, FIXTURE_XML.lastIndexOf(CLOSE))} <Song FilePath="${file}" FileSize="8" Flag="268435456">\r\n  <Tags Author="Jaydee" Title="Plastic &amp; Dreams" Genre="House" Album="Plastic Dreams" />\r\n </Song>\r\n${CLOSE}`,
    )
    expect(parseVirtualdjDatabase(lib.database()).at(-1)).toMatchObject({
      path: file,
      size: 8,
      title: 'Plastic & Dreams',
      artist: 'Jaydee',
      album: 'Plastic Dreams',
      genre: 'House',
    })
  })

  it('puts it in the lists picked for it, an existing one by its id and a new one by its name', async () => {
    const lib = library()
    const file = lib.track('Plastic Dreams.flac')
    const result = await applyVirtualdjBatch(
      [
        added(file, {
          wanted: [{ id: 'Carpeta/Dentro', name: 'Dentro' }, { name: 'Viernes' }],
        }),
      ],
      lib.deps,
    )
    expect(result).toMatchObject({ ok: true, outcomes: [{ id: 'op1', applied: true }] })
    expect(lib.list('Carpeta/Dentro')).toEqual(['/Music/Serato Pruebas/Pray.mp3', file])
    expect(lib.list('Viernes')).toEqual([file])
    expect(readFileSync(join(lib.dir, 'MyLists', 'order'), 'utf8')).toBe(
      'Carpeta\nSurco prueba\nSurco escrita\nViernes\n',
    )
  })

  it('takes it out of a list it was in that the pick leaves, and leaves a list it was never told about', async () => {
    const lib = library()
    const result = await applyVirtualdjBatch(
      [
        added('/Music/Serato Pruebas/Pray.mp3', {
          add: undefined,
          wanted: [],
          known: ['Surco prueba'],
        }),
      ],
      lib.deps,
    )
    expect(result).toMatchObject({
      ok: true,
      outcomes: [{ applied: true, notices: [{ code: 'playlist-changed', playlist: 'Dentro' }] }],
    })
    expect(lib.list('Surco prueba')).not.toContain('/Music/Serato Pruebas/Pray.mp3')
    expect(lib.list('Carpeta/Dentro')).toEqual(['/Music/Serato Pruebas/Pray.mp3'])
  })

  it('does not add a second <Song> for a file the database already has', async () => {
    const lib = library()
    const before = lib.database()
    const result = await applyVirtualdjBatch([added(HELD)], lib.deps)
    expect(result).toMatchObject({ ok: true, wrote: false, outcomes: [{ applied: true }] })
    expect(lib.database()).toBe(before)
  })

  it('writes a file on a drive into that drive database with its letter, leaving the home one as it was', async () => {
    const lib = library()
    const driveXml = `<?xml version="1.0" encoding="UTF-8"?>\r\n<VirtualDJ_Database Version="2026">\r\n <Song FilePath="E:/Otra/b.mp3" FileSize="3" Flag="268435456">\r\n </Song>\r\n${CLOSE}`
    const volume = lib.drive('Public', driveXml)
    mkdirSync(join(volume, 'Musica'))
    const file = join(volume, 'Musica', 'Plastic Dreams.flac')
    writeFileSync(file, 'abcd')
    const home = lib.database()
    await applyVirtualdjBatch([added(file)], lib.deps)
    expect(lib.database()).toBe(home)
    expect(readFileSync(join(volume, 'VirtualDJ', 'database.xml'), 'utf8')).toBe(
      `${driveXml.slice(0, driveXml.lastIndexOf(CLOSE))} <Song FilePath="E:/Musica/Plastic Dreams.flac" FileSize="4" Flag="268435456">\r\n  <Tags Author="Jaydee" Title="Plastic &amp; Dreams" Genre="House" Album="Plastic Dreams" />\r\n </Song>\r\n${CLOSE}`,
    )
  })

  it('keeps a track whose source VirtualDJ still plays out of the database and of the picked lists', async () => {
    const lib = library()
    const file = lib.track('Pray.flac')
    const before = lib.database()
    const result = await applyVirtualdjBatch(
      [
        added(file, {
          from: HELD,
          add: undefined,
          wanted: [{ id: 'Surco escrita', name: 'Surco escrita' }],
        }),
      ],
      lib.deps,
    )
    expect(result).toMatchObject({
      ok: true,
      outcomes: [
        {
          applied: true,
          uncounted: true,
          notices: [{ code: 'source-in-virtualdj', playlist: 'Surco escrita' }],
        },
      ],
    })
    expect(lib.database()).toBe(before)
    expect(lib.list('Surco escrita')).not.toContain(file)
  })

  it('waits while VirtualDJ is open and writes once it closes, the database and the lists each into their own copies', async () => {
    const lib = library()
    const file = lib.track('Plastic Dreams.flac')
    const queue = createRekordboxQueue({
      store: { read: () => null, write: () => {}, setAside: () => {} },
      collection: () => lib.dir,
      applyBatch: (_c, ops, ensureClosed, stillQueued) =>
        applyVirtualdjBatch(ops, { ...lib.deps, ensureClosed, stillQueued }),
      repoint: async () => [],
      nodeStamps: async () => ({}),
      onChange: () => {},
      addsTracks: false,
    })
    queue.enqueue([added(file, { wanted: [{ id: 'Surco escrita', name: 'Surco escrita' }] })])
    lib.setOpen(true)
    expect(await queue.apply(async () => !(await lib.deps.virtualdjOpen()))).toEqual({
      status: 'refused',
      reason: 'cancelled',
    })
    expect(parseVirtualdjDatabase(lib.database()).map((s) => s.path)).not.toContain(file)
    lib.setOpen(false)
    expect(await queue.apply(async () => true)).toMatchObject({ status: 'applied', tracks: 1 })
    expect(parseVirtualdjDatabase(lib.database()).map((s) => s.path)).toContain(file)
    expect(lib.list('Surco escrita')).toContain(file)
    expect(lib.backups()).toHaveLength(1)
    expect(lib.backups('lists')).toHaveLength(1)
    expect(await queue.apply(async () => true)).toEqual({ status: 'empty' })
  })
})

describe('virtualdjLibraryHas', () => {
  it('says a file is held when its database has it, or its source when the conversion came from one', () => {
    const lib = library()
    const has = virtualdjLibraryHas(lib.roots())
    expect(has(HELD)).toBe(true)
    expect(has('/Music/new.flac')).toBe(false)
    expect(has('/Music/new.flac', HELD)).toBe(true)
  })
})
