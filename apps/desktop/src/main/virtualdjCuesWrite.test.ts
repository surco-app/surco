import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { HOT_KINDS, type WantedCue } from '../shared/cueRules'
import { hotCueArgb } from '../shared/rekordboxCueColors'
import type { TrackCues } from '../shared/types'
import { createRekordboxQueue } from './rekordboxQueue'
import type { CuesOp } from './rekordboxQueueOps'
import { virtualdjCueSource } from './virtualdjCueSource'
import { applyVirtualdjCuesBatch } from './virtualdjCuesWrite'
import { parseVirtualdjDatabase } from './virtualdjDatabase'
import { virtualdjLibraryRoots } from './virtualdjLibrary'

const fixture = readFileSync(join(__dirname, 'virtualdjFixtures', 'database.xml'), 'utf8')
const MP3 = '/Music/VirtualDJ Pruebas/Pray.mp3'
const FLAC = '/Music/Serato Pruebas/Pray.flac'

function library(xml = fixture) {
  const base = mkdtempSync(join(tmpdir(), 'surco-vdj-cues-write-'))
  const dir = join(base, 'VirtualDJ')
  mkdirSync(dir)
  const database = join(dir, 'database.xml')
  writeFileSync(database, xml)
  const backupDir = join(base, 'virtualdj-backups')
  let open = false
  const deps = {
    backupDir,
    roots: () => [{ dir, root: '/' }],
    virtualdjOpen: vi.fn(async () => open),
    ensureClosed: vi.fn(async () => !open),
  }
  const reader = virtualdjCueSource(
    {
      roots: () => [{ dir, root: '/' }],
      words: async () => null,
      beatGrid: async () => null,
      queue: { enqueue: vi.fn(), cuesOp: vi.fn(), drop: vi.fn() },
      applyQuietly: vi.fn(),
    },
    () => '',
  )
  const read = async (path: string) => (await reader.trackCues(`virtualdj:${path}`)) as TrackCues
  const backups = () => {
    try {
      return readdirSync(backupDir)
    } catch {
      return []
    }
  }
  return {
    dir,
    database,
    deps,
    read,
    backups,
    setOpen: (v: boolean) => {
      open = v
    },
  }
}

const wantedOf = (read: TrackCues): WantedCue[] =>
  read.cues.map((c) => ({ id: c.id, ms: c.ms, kind: c.kind, color: c.color }))

function op(path: string, read: TrackCues, wanted: WantedCue[], over: Partial<CuesOp> = {}) {
  return {
    id: 'op1',
    kind: 'cues',
    contentId: `virtualdj:${path}`,
    path,
    label: 'Pray',
    wanted,
    fingerprint: read.fingerprint,
    ...over,
  } satisfies CuesOp
}

const songOf = (xml: string, path: string) =>
  parseVirtualdjDatabase(xml).find((s) => s.path === path)

describe('applyVirtualdjCuesBatch', () => {
  it("writes a drive track's cues into that drive's database and leaves the home one alone", async () => {
    const { dir, database, deps } = library()
    const volumes = join(dirname(dir), 'Volumes')
    const driveDir = join(volumes, 'Public', 'VirtualDJ')
    mkdirSync(driveDir, { recursive: true })
    mkdirSync(join(volumes, 'Bare'))
    const driveDatabase = join(driveDir, 'database.xml')
    const driveXml = `<?xml version="1.0" encoding="UTF-8"?>\r\n<VirtualDJ_Database Version="2026">\r\n <Song FilePath="D:/Musica/It&apos;s Mine.flac" FileSize="100" Flag="268435456">\r\n  <Infos SongLength="200.0" />\r\n  <Poi Name="Surco" Pos="30.0" Num="1" Type="cue" />\r\n </Song>\r\n</VirtualDJ_Database>\r\n`
    writeFileSync(driveDatabase, driveXml)
    const roots = () => virtualdjLibraryRoots(dir, volumes)
    const reader = virtualdjCueSource(
      {
        roots,
        words: async () => null,
        beatGrid: async () => null,
        queue: { enqueue: vi.fn(), cuesOp: vi.fn(), drop: vi.fn() },
        applyQuietly: vi.fn(),
      },
      () => '',
    )
    const file = join(volumes, 'Public', 'Musica', "It's Mine.flac")
    const before = (await reader.trackCues(`virtualdj:${file}`)) as TrackCues
    expect(before.cues.map((c) => c.ms)).toEqual([30000])
    const result = await applyVirtualdjCuesBatch(
      [op(file, before, [{ ...wantedOf(before)[0], ms: 31000 }])],
      { ...deps, roots },
    )
    expect(result).toMatchObject({ ok: true, wrote: true })
    expect(readFileSync(database, 'utf8')).toBe(fixture)
    expect(readFileSync(driveDatabase, 'utf8')).toBe(driveXml.replace('Pos="30.0"', 'Pos="31.0"'))
    expect(existsSync(join(volumes, 'Bare', 'VirtualDJ'))).toBe(false)
  })

  it('writes the moved and added hot cues with VirtualDJ closed, and they read back as saved', async () => {
    const { database, deps, read, backups } = library()
    const before = await read(MP3)
    const wanted: WantedCue[] = [
      { ...wantedOf(before)[0], ms: 31000 },
      { ms: 60500, kind: HOT_KINDS[2], color: 5 },
    ]
    const result = await applyVirtualdjCuesBatch([op(MP3, before, wanted)], deps)
    expect(result).toEqual({
      ok: true,
      wrote: true,
      outcomes: [{ id: 'op1', applied: true, notices: [] }],
    })
    const after = await read(MP3)
    expect(after.cues.map((c) => [c.ms, c.kind, c.color])).toEqual([
      [31000, HOT_KINDS[0], before.cues[0].color],
      [60500, HOT_KINDS[2], 5],
    ])
    expect(after.cues[0].name).toBe('Surco')
    expect(backups()).toHaveLength(1)
    const xml = readFileSync(database, 'utf8')
    expect(xml.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('writes a new cue’s colour as the unsigned ARGB VirtualDJ stores, from Surco’s palette', async () => {
    const { database, deps, read } = library()
    const before = await read(MP3)
    const wanted = [...wantedOf(before), { ms: 60500, kind: HOT_KINDS[1], color: 30 }]
    await applyVirtualdjCuesBatch([op(MP3, before, wanted)], deps)
    const poi = songOf(readFileSync(database, 'utf8'), MP3)?.pois.find((p) => p.num === 2)
    expect(poi?.color).toBe(hotCueArgb(30))
    expect(readFileSync(database, 'utf8')).toContain(`Num="2" Color="${hotCueArgb(30)}"`)
  })

  it('keeps a cue’s own VirtualDJ colour when the DJ did not change it, so a near palette match does not repaint it', async () => {
    const { database, deps, read } = library()
    const before = await read(MP3)
    const wanted = [{ ...wantedOf(before)[0], ms: 31000 }]
    await applyVirtualdjCuesBatch([op(MP3, before, wanted)], deps)
    expect(songOf(readFileSync(database, 'utf8'), MP3)?.pois.find((p) => p.num === 1)?.color).toBe(
      4278190335,
    )
  })

  it('leaves the file alone when the cues are what VirtualDJ already has', async () => {
    const { database, deps, read, backups } = library()
    const before = await read(FLAC)
    const result = await applyVirtualdjCuesBatch([op(FLAC, before, wantedOf(before))], deps)
    expect(result).toMatchObject({ ok: true, wrote: false })
    expect(readFileSync(database, 'utf8')).toBe(fixture)
    expect(backups()).toEqual([])
  })

  it('drops a CALL and says so, since VirtualDJ only keeps hot cues', async () => {
    const { deps, read } = library()
    const before = await read(MP3)
    const wanted = [...wantedOf(before), { ms: 90000, kind: 0, color: null }]
    const result = await applyVirtualdjCuesBatch([op(MP3, before, wanted)], deps)
    expect(result).toMatchObject({
      ok: true,
      outcomes: [
        {
          applied: true,
          notices: [{ code: 'cues-calls-dropped', track: 'Pray', calls: [90000] }],
        },
      ],
    })
  })

  it('still says the CALL was dropped when the set is applied again after the first try was cut short', async () => {
    const { deps, read } = library()
    const before = await read(MP3)
    const wanted = [
      { ...wantedOf(before)[0], ms: 31000 },
      { ms: 90000, kind: 0, color: null },
    ]
    await applyVirtualdjCuesBatch([op(MP3, before, wanted)], deps)
    const again = await applyVirtualdjCuesBatch([op(MP3, before, wanted)], deps)
    expect(again).toMatchObject({
      ok: true,
      wrote: false,
      outcomes: [
        {
          applied: true,
          notices: [{ code: 'cues-calls-dropped', track: 'Pray', calls: [90000] }],
        },
      ],
    })
  })

  it('keeps pads above 8, loops and the rest of the song, which the editor never shows', async () => {
    const xml = fixture.replace(
      '  <Poi Name="Surco" Pos="29.973878" Num="1" Color="4278190335" Type="cue" />\r\n',
      '  <Poi Name="Surco" Pos="29.973878" Num="1" Color="4278190335" Type="cue" />\r\n  <Poi Name="Nine" Pos="60.0" Num="9" Type="cue" />\r\n  <Poi Name="loop" Pos="278.306667" Num="-1" Color="4278190335" Type="loop" Size="4.0" Slot="1" />\r\n',
    )
    const { database, deps, read } = library(xml)
    const before = await read(MP3)
    await applyVirtualdjCuesBatch([op(MP3, before, [])], deps)
    const pois = songOf(readFileSync(database, 'utf8'), MP3)?.pois ?? []
    expect(pois.filter((p) => p.kind === 'cue').map((p) => p.num)).toEqual([9])
    expect(pois.filter((p) => p.kind === 'loop')).toHaveLength(1)
    expect(readFileSync(database, 'utf8')).toContain('Type="automix" Point="realStart"')
  })

  it('refuses a save made on cues that changed in VirtualDJ since, instead of overwriting them', async () => {
    const { database, deps, read } = library()
    const before = await read(MP3)
    const result = await applyVirtualdjCuesBatch(
      [op(MP3, before, [], { fingerprint: 'stale' })],
      deps,
    )
    expect(result).toMatchObject({
      ok: true,
      wrote: false,
      outcomes: [{ applied: false, notices: [{ code: 'cues-changed', track: 'Pray' }] }],
    })
    expect(readFileSync(database, 'utf8')).toBe(fixture)
  })

  it('says the track is no longer in VirtualDJ when its database does not hold it, rather than a write failure', async () => {
    const { deps, read } = library()
    const before = await read(MP3)
    const result = await applyVirtualdjCuesBatch(
      [op('/Music/gone.mp3', before, [], { contentId: 'virtualdj:/Music/gone.mp3' })],
      deps,
    )
    expect(result).toMatchObject({
      ok: true,
      outcomes: [{ applied: false, notices: [{ code: 'not-in-library', track: 'Pray' }] }],
    })
  })

  it('reads again and puts the cues on what someone else wrote meanwhile, never over it', async () => {
    const { database, deps, read } = library()
    const before = await read(MP3)
    const theirs = fixture.replace('Genre="Electronic"', 'Genre="House"')
    let calls = 0
    deps.virtualdjOpen.mockImplementation(async () => {
      if (calls++ === 1) writeFileSync(database, theirs)
      return false
    })
    const wanted = [{ ...wantedOf(before)[0], ms: 31000 }]
    const result = await applyVirtualdjCuesBatch([op(MP3, before, wanted)], deps)
    expect(result).toMatchObject({ ok: true, wrote: true })
    const xml = readFileSync(database, 'utf8')
    expect(xml).toContain('Genre="House"')
    expect(songOf(xml, MP3)?.pois.find((p) => p.num === 1)?.seconds).toBe(31)
  })

  it('writes nothing while VirtualDJ is open', async () => {
    const { database, deps, read, setOpen } = library()
    const before = await read(MP3)
    setOpen(true)
    const result = await applyVirtualdjCuesBatch([op(MP3, before, [])], deps)
    expect(result).toEqual({ ok: false, reason: 'cancelled' })
    expect(readFileSync(database, 'utf8')).toBe(fixture)
  })
})

describe('the VirtualDJ cue queue', () => {
  function queued() {
    const lib = library()
    const queue = createRekordboxQueue({
      store: { read: () => null, write: () => {}, setAside: () => {} },
      collection: () => lib.dir,
      applyBatch: (_c, ops, ensureClosed, stillQueued) =>
        applyVirtualdjCuesBatch(ops, { ...lib.deps, ensureClosed, stillQueued }),
      repoint: async () => [],
      nodeStamps: async () => ({}),
      onChange: () => {},
      addsTracks: false,
    })
    return { ...lib, queue }
  }
  const closedNow = (lib: { setOpen: (v: boolean) => void }) => async () => {
    lib.setOpen(false)
    return true
  }

  it('waits while VirtualDJ is open and writes once when it closes', async () => {
    const lib = queued()
    const before = await lib.read(MP3)
    lib.setOpen(true)
    lib.queue.enqueue([op(MP3, before, [{ ...wantedOf(before)[0], ms: 31000 }])])
    expect(await lib.queue.apply(async () => false)).toEqual({
      status: 'refused',
      reason: 'cancelled',
    })
    expect(readFileSync(lib.database, 'utf8')).toBe(fixture)
    expect(lib.queue.isEmpty()).toBe(false)
    expect(await lib.queue.apply(closedNow(lib))).toMatchObject({ status: 'applied' })
    expect((await lib.read(MP3)).cues[0].ms).toBe(31000)
    expect(lib.backups()).toHaveLength(1)
    expect(lib.queue.isEmpty()).toBe(true)
    expect(await lib.queue.apply(closedNow(lib))).toEqual({ status: 'empty' })
    expect(lib.backups()).toHaveLength(1)
  })

  it('keeps the save waiting when VirtualDJ opens between reading and renaming', async () => {
    const lib = queued()
    const before = await lib.read(MP3)
    lib.queue.enqueue([op(MP3, before, [{ ...wantedOf(before)[0], ms: 31000 }])])
    lib.deps.virtualdjOpen.mockResolvedValueOnce(false).mockResolvedValue(true)
    expect(await lib.queue.apply(async () => true)).toEqual({
      status: 'refused',
      reason: 'cancelled',
    })
    expect(readFileSync(lib.database, 'utf8')).toBe(fixture)
    expect(readdirSync(lib.dir)).toEqual(['database.xml'])
    expect(lib.queue.isEmpty()).toBe(false)
  })

  it('writes nothing for a save the DJ undid while it waited', async () => {
    const lib = queued()
    const before = await lib.read(MP3)
    lib.queue.enqueue([op(MP3, before, [{ ...wantedOf(before)[0], ms: 31000 }])])
    const waiting = lib.queue.cuesOp(`virtualdj:${MP3}`)
    lib.queue.drop(waiting?.id as string)
    await lib.queue.apply(closedNow(lib))
    expect(readFileSync(lib.database, 'utf8')).toBe(fixture)
    expect(lib.backups()).toEqual([])
  })
})
