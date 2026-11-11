import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { LibraryTagUpdate } from '../shared/types'
import { createRekordboxQueue, type QueueStore } from './rekordboxQueue'
import { applyVirtualdjBatch } from './virtualdjBatch'
import { virtualdjLibraryRoots } from './virtualdjLibrary'
import { syncVirtualdjTags, virtualdjTagOps } from './virtualdjTagSync'

const fixture = join(__dirname, 'virtualdjFixtures')
const FIXTURE_XML = readFileSync(join(fixture, 'database.xml'), 'utf8')
const PRAY = '/Music/VirtualDJ Pruebas/Pray.mp3'
const TAGS =
  '  <Tags Author="Tina Cousins" Title="Pray (W.I.P. In The Church Mix)" Genre="Electronic" Album="Pray" TrackNumber="01" Year="1998" Bpm="0.447761" Key="Ebm" Flag="1" />'

const memoryStore = (): QueueStore => {
  let text: string | null = null
  return {
    read: () => text,
    write: (t) => {
      text = t
    },
    setAside: () => {},
  }
}

function library({ running = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'surco-vdj-tags-'))
  const dir = join(base, 'VirtualDJ')
  cpSync(fixture, dir, { recursive: true })
  const volumes = join(base, 'Volumes')
  mkdirSync(volumes)
  let open = running
  const roots = () => virtualdjLibraryRoots(dir, volumes)
  const deps = {
    backupDir: join(base, 'virtualdj-backups'),
    roots,
    virtualdjOpen: vi.fn(async () => open),
  }
  const queue = createRekordboxQueue({
    store: memoryStore(),
    collection: () => dir,
    applyBatch: (_l, ops, ensureClosed, stillQueued) =>
      applyVirtualdjBatch(ops, { ...deps, ensureClosed, stillQueued }),
    repoint: async () => [],
    nodeStamps: async () => ({}),
    onChange: () => {},
    addsTracks: false,
  })
  const sync = {
    enabled: true,
    roots,
    queue,
    isRunning: async () => open,
    onWaiting: vi.fn(),
    onApplied: vi.fn(),
  }
  return {
    dir,
    volumes,
    roots,
    queue,
    sync,
    database: () => readFileSync(join(dir, 'database.xml'), 'utf8'),
    setOpen: (v: boolean) => {
      open = v
    },
  }
}

const REVIEW: LibraryTagUpdate[] = [
  {
    path: PRAY,
    fields: {
      title: { from: 'Pray (W.I.P. In The Church Mix)', to: 'Pray & Praise' },
      artist: { from: 'Tina Cousins', to: 'Tina' },
      album: { from: 'Pray', to: 'Pray EP' },
      genre: { from: 'Electronic', to: 'House' },
      albumArtist: { from: '', to: 'Various' },
    },
  },
]

describe('virtualdjTagOps', () => {
  it('takes title, artist, album and genre for a track VirtualDJ has, and leaves the rest out', () => {
    const lib = library()
    expect(
      virtualdjTagOps(
        [...REVIEW, { path: '/Music/elsewhere.mp3', fields: { title: { from: 'a', to: 'b' } } }],
        lib.roots(),
      ),
    ).toEqual([
      {
        id: expect.any(String),
        kind: 'tags',
        path: PRAY,
        label: 'Pray.mp3',
        fields: { tsng: 'Pray & Praise', tart: 'Tina', talb: 'Pray EP', tgen: 'House' },
        from: {
          tsng: 'Pray (W.I.P. In The Church Mix)',
          tart: 'Tina Cousins',
          talb: 'Pray',
          tgen: 'Electronic',
        },
      },
    ])
  })
})

describe('syncVirtualdjTags', () => {
  it('writes the four tags into the song with VirtualDJ closed, keeping every other attribute and byte as it was', async () => {
    const lib = library()
    expect(await syncVirtualdjTags(REVIEW, lib.sync)).toEqual({ outcome: 'updated', count: 1 })
    expect(lib.database()).toBe(
      FIXTURE_XML.replace(
        TAGS,
        '  <Tags Author="Tina" Title="Pray &amp; Praise" Genre="House" Album="Pray EP" TrackNumber="01" Year="1998" Bpm="0.447761" Key="Ebm" Flag="1" />',
      ),
    )
  })

  it('waits while VirtualDJ is open, says it will save on close, and writes once it is closed', async () => {
    const lib = library({ running: true })
    expect(await syncVirtualdjTags(REVIEW, lib.sync)).toEqual({ outcome: 'queued' })
    expect(lib.sync.onWaiting).toHaveBeenCalled()
    expect(lib.database()).toBe(FIXTURE_XML)
    lib.setOpen(false)
    expect(await lib.queue.apply(async () => true)).toMatchObject({ status: 'applied', tracks: 1 })
    expect(lib.database()).toContain('Title="Pray &amp; Praise"')
  })

  it('leaves a song alone when its tags changed in VirtualDJ since the review read them', async () => {
    const lib = library()
    writeFileSync(
      join(lib.dir, 'database.xml'),
      FIXTURE_XML.replace(
        'Title="Pray (W.I.P. In The Church Mix)" Genre="Electronic" Album="Pray" TrackNumber="01"',
        'Title="Pray (mine)" Genre="Electronic" Album="Pray" TrackNumber="01"',
      ),
    )
    const before = lib.database()
    expect(await syncVirtualdjTags(REVIEW, lib.sync)).toEqual({ outcome: 'nothing' })
    expect(lib.database()).toBe(before)
  })

  it('writes the tags of a song on a drive into that drive database', async () => {
    const lib = library()
    const drive = join(lib.volumes, 'Public')
    mkdirSync(join(drive, 'VirtualDJ'), { recursive: true })
    const driveXml = `<?xml version="1.0" encoding="UTF-8"?>\r\n<VirtualDJ_Database Version="2026">\r\n <Song FilePath="D:/Musica/b.mp3" FileSize="3" Flag="268435456">\r\n  <Tags Author="A" Title="B" />\r\n </Song>\r\n</VirtualDJ_Database>\r\n`
    writeFileSync(join(drive, 'VirtualDJ', 'database.xml'), driveXml)
    const update = [
      { path: join(drive, 'Musica', 'b.mp3'), fields: { title: { from: 'B', to: 'C' } } },
    ]
    expect(await syncVirtualdjTags(update, lib.sync)).toEqual({ outcome: 'updated', count: 1 })
    expect(readFileSync(join(drive, 'VirtualDJ', 'database.xml'), 'utf8')).toBe(
      driveXml.replace('Title="B"', 'Title="C"'),
    )
    expect(lib.database()).toBe(FIXTURE_XML)
  })

  it('does nothing with its sync off', async () => {
    const lib = library()
    expect(await syncVirtualdjTags(REVIEW, { ...lib.sync, enabled: false })).toEqual({
      outcome: 'nothing',
    })
    expect(lib.database()).toBe(FIXTURE_XML)
  })
})
