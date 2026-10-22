import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('./rekordboxDb', async (actual) => {
  const real = await actual<typeof import('./rekordboxDb')>()
  return { ...real, openRekordboxDb: vi.fn(real.openRekordboxDb) }
})

import { CALLS_ONLY, MY_FLOW } from '../shared/cueFlows'
import { flowOutcome } from '../shared/cueRules'
import type { DropInput } from '../shared/dropDetect'
import type { TrackCues } from '../shared/types'
import { anlzFile, pqtzSection, pwv5Section } from './anlzFixture'
import { analysedTrack } from './enginePerformanceFixture'
import { writeEngineLibraryFixture } from './enginePlaylistsFixture'
import { registerRekordboxCuesIpc } from './rekordboxCuesIpc'
import { openRekordboxDb } from './rekordboxDb'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'
import type { RekordboxQueue } from './rekordboxQueue'
import type { CuesOp } from './rekordboxQueueOps'

function handler(channel: string): (...args: unknown[]) => unknown {
  const call = [...vi.mocked(ipcMain.handle).mock.calls].reverse().find(([n]) => n === channel)
  if (!call) throw new Error(`${channel} not registered`)
  return call[1] as (...args: unknown[]) => unknown
}

const ANLZ = '/PIONEER/USBANLZ/1/a/ANLZ0000.DAT'

function queue(over: Partial<Pick<RekordboxQueue, 'enqueue' | 'cuesOp' | 'drop'>> = {}) {
  return {
    enqueue: vi.fn<RekordboxQueue['enqueue']>(() => true),
    cuesOp: vi.fn<RekordboxQueue['cuesOp']>(() => undefined),
    drop: vi.fn<RekordboxQueue['drop']>(),
    ...over,
  }
}

const quietly = () => vi.fn<() => void>()

const savedOp = (over: Partial<CuesOp> = {}): CuesOp => ({
  id: 'c1',
  kind: 'cues',
  contentId: '103',
  path: '/m/a.wav',
  label: 'a',
  fingerprint: 'F1',
  ...over,
})

async function collectionWithMp3(encoder: 'LAME' | 'Lavc'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'surco-rblead-'))
  const mp3 = join(dir, 'track.mp3')
  execFileSync(ffmpegStatic as unknown as string, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    mp3,
  ])
  const bytes = readFileSync(mp3)
  bytes.write(encoder, bytes.indexOf('Lavc'), 'latin1')
  writeFileSync(mp3, bytes)
  const path = join(dir, 'master.db')
  writeRekordboxPlaylistFixture(path, {
    ...ORGANISE_FIXTURE,
    content: ORGANISE_FIXTURE.content.map((c) => (c.ID === '101' ? { ...c, FolderPath: mp3 } : c)),
  })
  return path
}

async function completableCollection(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'surco-rbcount-'))
  const path = join(dir, 'master.db')
  writeRekordboxPlaylistFixture(path, {
    ...ORGANISE_FIXTURE,
    content: ORGANISE_FIXTURE.content.map((c) =>
      c.ID === '101' ? { ...c, AnalysisDataPath: ANLZ } : c,
    ),
    cueRows: [{ ID: '11', ContentID: '101', InMsec: 128000, Kind: 0, ColorTableIndex: null }],
  })
  mkdirSync(join(dir, 'share/PIONEER/USBANLZ/1/a'), { recursive: true })
  writeFileSync(
    join(dir, 'share', ANLZ),
    anlzFile(pqtzSection(Array.from({ length: 800 }, (_, i) => i * 500))),
  )
  return path
}

const BEATS = Array.from({ length: 800 }, (_, i) => i * 500)

function myFlowRows(contentId: string, dropMs: number) {
  const out = flowOutcome({
    existing: [],
    drops: [dropMs],
    previousDrops: [],
    beats: BEATS,
    strong: [],
    phrases: [],
    flow: MY_FLOW,
  })
  if (out.status !== 'plan') throw new Error('the fixture flow must plan')
  return out.wanted.map((c, i) => ({
    ID: `${contentId}${i}`,
    ContentID: contentId,
    InMsec: c.ms,
    Kind: c.kind,
    ColorTableIndex: c.color,
  }))
}

async function markedCollection(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'surco-rblearn-'))
  const path = join(dir, 'master.db')
  writeRekordboxPlaylistFixture(path, {
    ...ORGANISE_FIXTURE,
    content: ORGANISE_FIXTURE.content.map((c) => ({ ...c, AnalysisDataPath: ANLZ })),
    cueRows: [
      ...myFlowRows('101', 128000),
      ...myFlowRows('102', 160000),
      ...myFlowRows('103', 192000),
      { ID: '1041', ContentID: '104', InMsec: 8000, Kind: 1, ColorTableIndex: 56 },
      { ID: '1042', ContentID: '104', InMsec: 8000, Kind: 0, ColorTableIndex: null },
    ],
  })
  mkdirSync(join(dir, 'share/PIONEER/USBANLZ/1/a'), { recursive: true })
  writeFileSync(join(dir, 'share', ANLZ), anlzFile(pqtzSection(BEATS)))
  return path
}

describe('registerRekordboxCuesIpc', () => {
  async function detailCollection(withWave: boolean): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'surco-rbdetail-'))
    const path = join(dir, 'master.db')
    writeRekordboxPlaylistFixture(path, {
      ...ORGANISE_FIXTURE,
      content: ORGANISE_FIXTURE.content.map((c) =>
        c.ID === '101' ? { ...c, AnalysisDataPath: ANLZ } : c,
      ),
    })
    mkdirSync(join(dir, 'share/PIONEER/USBANLZ/1/a'), { recursive: true })
    writeFileSync(join(dir, 'share', ANLZ), anlzFile(pqtzSection(BEATS)))
    if (withWave)
      writeFileSync(
        join(dir, 'share', ANLZ.replace(/\.DAT$/, '.EXT')),
        anlzFile(
          pwv5Section([
            { r: 7, g: 0, b: 0, h: 31 },
            { r: 0, g: 0, b: 7, h: 16 },
          ]),
        ),
      )
    return path
  }

  it('reads the whole colour wave of a track for the maximized editor and never changes the collection', async () => {
    const path = await detailCollection(true)
    const before = readFileSync(path)
    vi.mocked(openRekordboxDb).mockClear()
    registerRekordboxCuesIpc({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    const words = (await handler('rekordbox:cueWaveDetail')({}, '101')) as Uint16Array
    expect([...words]).toEqual([(7 << 13) | (31 << 2), (7 << 7) | (16 << 2)])
    expect(vi.mocked(openRekordboxDb)).toHaveBeenCalled()
    expect(vi.mocked(openRekordboxDb).mock.calls.every(([, o]) => o?.readonly === true)).toBe(true)
    expect(readFileSync(path).equals(before)).toBe(true)
  })

  it('reads nothing outside the share folder and survives an unreadable EXT', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surco-rbescape-'))
    const path = join(dir, 'master.db')
    writeRekordboxPlaylistFixture(path, {
      ...ORGANISE_FIXTURE,
      content: ORGANISE_FIXTURE.content.map((c) =>
        c.ID === '101' ? { ...c, AnalysisDataPath: '/../x.DAT' } : c,
      ),
    })
    mkdirSync(join(dir, 'share'), { recursive: true })
    writeFileSync(join(dir, 'x.EXT'), anlzFile(pwv5Section([{ r: 7, g: 0, b: 0, h: 31 }])))
    registerRekordboxCuesIpc({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    expect(await handler('rekordbox:cueWaveDetail')({}, '101')).toBeNull()
  })

  it('has no detail for a track without PWV5, an unknown track or no collection', async () => {
    const path = await detailCollection(false)
    registerRekordboxCuesIpc({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    expect(await handler('rekordbox:cueWaveDetail')({}, '101')).toBeNull()
    expect(await handler('rekordbox:cueWaveDetail')({}, '999')).toBeNull()
    registerRekordboxCuesIpc({
      collection: () => '',
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    expect(await handler('rekordbox:cueWaveDetail')({}, '101')).toBeNull()
  })

  it('learns the flow from the marked tracks of the collection, opened read-only and never changed', async () => {
    const path = await markedCollection()
    const before = readFileSync(path)
    vi.mocked(openRekordboxDb).mockClear()
    registerRekordboxCuesIpc({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    const learned = await handler('rekordbox:learnFlow')({})
    expect(learned).toEqual({
      flow: expect.objectContaining({ rules: [MY_FLOW.rules[0]] }),
      coverage: { matching: 3, marked: 3 },
    })
    expect(vi.mocked(openRekordboxDb).mock.calls.every(([, o]) => o?.readonly === true)).toBe(true)
    expect(vi.mocked(openRekordboxDb)).toHaveBeenCalled()
    expect(readFileSync(path).equals(before)).toBe(true)
  })

  it('learns nothing without a collection', async () => {
    registerRekordboxCuesIpc({
      collection: () => '',
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    expect(await handler('rekordbox:learnFlow')({})).toBeNull()
  })

  it('counts what the active flow would complete, none with Solo CALL', async () => {
    const path = await completableCollection()
    const host = (flow: () => typeof MY_FLOW) => ({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow,
      beatGrid: async () => null,
      words: async () => null,
    })
    registerRekordboxCuesIpc(host(() => MY_FLOW))
    expect(await handler('rekordbox:countCompletable')({})).toBe(1)
    registerRekordboxCuesIpc(host(() => CALLS_ONLY))
    expect(await handler('rekordbox:countCompletable')({})).toBe(0)
  })

  it('queues the cues and applies quietly, since "Guardar en rekordbox" never asks', async () => {
    const enqueue = vi.fn<RekordboxQueue['enqueue']>(() => true)
    const applyQuietly = quietly()
    registerRekordboxCuesIpc({
      collection: () => '/c/master.db',
      queue: queue({ enqueue }),
      applyQuietly,
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    const req = {
      contentId: '103',
      path: '/m/a.wav',
      label: 'a',
      wanted: [{ ms: 1000, kind: 0, color: null }],
      fingerprint: 'f',
    }
    expect(await handler('rekordbox:saveCues')({}, [req])).toBe('queued')
    expect(enqueue).toHaveBeenCalledWith([expect.objectContaining({ kind: 'cues', ...req })])
    expect(applyQuietly).toHaveBeenCalled()
  })

  it('says the cues were not queued when the queue belongs to another collection, and applies nothing', async () => {
    const applyQuietly = quietly()
    registerRekordboxCuesIpc({
      collection: () => '/c/master.db',
      queue: queue({ enqueue: vi.fn<RekordboxQueue['enqueue']>(() => false) }),
      applyQuietly,
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    const req = {
      contentId: '103',
      path: '/m/a.wav',
      label: 'a',
      wanted: [],
      fingerprint: 'f',
    }
    expect(await handler('rekordbox:saveCues')({}, [req])).toBe('other-collection')
    expect(applyQuietly).not.toHaveBeenCalled()
  })

  it('queues several tracks together and applies once, so master.db is written in one batch', async () => {
    const enqueue = vi.fn<RekordboxQueue['enqueue']>(() => true)
    const applyQuietly = quietly()
    registerRekordboxCuesIpc({
      collection: () => '/c/master.db',
      queue: queue({ enqueue }),
      applyQuietly,
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    const req = (contentId: string) => ({
      contentId,
      path: `/m/${contentId}.wav`,
      label: contentId,
      wanted: [{ ms: 1000, kind: 0, color: null }],
      fingerprint: 'f',
    })
    await handler('rekordbox:saveCues')({}, [req('103'), req('104')])
    expect(enqueue).toHaveBeenCalledTimes(1)
    const [ops] = enqueue.mock.calls[0]
    expect(ops.map((o) => (o.kind === 'cues' ? o.contentId : null))).toEqual(['103', '104'])
    expect(new Set(ops.map((o) => o.id)).size).toBe(2)
    expect(applyQuietly).toHaveBeenCalledTimes(1)
  })

  it('tells the editor how far rekordbox runs ahead of what it plays on a LAME MP3, so a cue set by ear lands where it was heard', async () => {
    const path = await collectionWithMp3('LAME')
    registerRekordboxCuesIpc({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    expect(await handler('rekordbox:auditionLead')({}, '101')).toBeCloseTo((1152 / 44100) * 1000, 3)
  })

  it('gives no lead for an MP3 the editor already plays in step with rekordbox', async () => {
    const path = await collectionWithMp3('Lavc')
    registerRekordboxCuesIpc({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    expect(await handler('rekordbox:auditionLead')({}, '101')).toBe(0)
  })

  it('gives no lead for a track the collection does not hold', async () => {
    const path = await collectionWithMp3('LAME')
    registerRekordboxCuesIpc({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    expect(await handler('rekordbox:auditionLead')({}, '999')).toBe(0)
  })

  it('lays a grid of its own on a track rekordbox has not analysed, in rekordbox time, so the editor can place cues without opening rekordbox', async () => {
    const path = await collectionWithMp3('LAME')
    const beatGrid = vi.fn(async () => ({ bpm: 120, firstMs: 100 }))
    registerRekordboxCuesIpc({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid,
      words: async () => Uint16Array.from([7, 8, 9]),
    })
    const out = (await handler('rekordbox:surcoGrid')({}, '101')) as {
      bpm: number
      grid: { ms: number; beat: number }[]
      words: Uint16Array | null
    }
    expect(beatGrid).toHaveBeenCalledWith(expect.stringMatching(/track\.mp3$/))
    expect(out.bpm).toBe(120)
    expect(out.grid[0].ms).toBe(Math.round(100 + ((1152 + 576 + 529) / 44100) * 1000 + 2))
    expect(out.grid[1].ms - out.grid[0].ms).toBe(500)
    expect(out.grid.every((b) => b.beat === 0)).toBe(true)
    expect(out.grid.at(-1)?.ms).toBeLessThan(256000)
  })

  it('draws the wave Surco measured, moved into rekordbox time so the kick sits on its beat line', async () => {
    const path = await collectionWithMp3('LAME')
    registerRekordboxCuesIpc({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => ({ bpm: 120, firstMs: 100 }),
      words: async () => Uint16Array.from([7, 8, 9]),
    })
    const out = (await handler('rekordbox:surcoGrid')({}, '101')) as { words: Uint16Array }
    const lead = Math.round((((1152 + 576 + 529) / 44100) * 1000 * 150) / 1000)
    expect(Array.from(out.words)).toEqual([...Array(lead).fill(0), 7, 8, 9])
  })

  it('offers no grid for a track Surco hears no beat in', async () => {
    const path = await collectionWithMp3('LAME')
    registerRekordboxCuesIpc({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    expect(await handler('rekordbox:surcoGrid')({}, '101')).toBeNull()
  })

  it('offers no grid for a track the collection does not hold, without decoding anything', async () => {
    const path = await collectionWithMp3('LAME')
    const beatGrid = vi.fn(async () => ({ bpm: 120, firstMs: 100 }))
    registerRekordboxCuesIpc({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid,
      words: async () => null,
    })
    expect(await handler('rekordbox:surcoGrid')({}, '999')).toBeNull()
    expect(beatGrid).not.toHaveBeenCalled()
  })

  it('reads nothing without a collection', async () => {
    registerRekordboxCuesIpc({
      collection: () => '',
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    expect(await handler('rekordbox:trackCues')({}, '103')).toBeNull()
    expect(handler('rekordbox:countCompletable')({})).toBe(0)
    expect(await handler('rekordbox:auditionLead')({}, '103')).toBe(0)
  })

  it('reports the cues queued for a track with the fingerprint they were built on, or null when nothing waits', () => {
    const wanted = [{ ms: 1000, kind: 0, color: null }]
    const queued = savedOp({ wanted })
    registerRekordboxCuesIpc({
      collection: () => '/c/master.db',
      queue: queue({ cuesOp: (id) => (id === '103' ? queued : undefined) }),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    return Promise.all([
      expect(handler('rekordbox:queuedCues')({}, '103')).resolves.toEqual({
        wanted,
        fingerprint: 'F1',
      }),
      expect(handler('rekordbox:queuedCues')({}, '104')).resolves.toBeNull(),
    ])
  })

  it('shows a save queued before wanted sets as the set it would write, so the section can see and discard it', async () => {
    const path = await completableCollection()
    const host = (cuesOp: RekordboxQueue['cuesOp']) => ({
      collection: () => path,
      queue: queue({ cuesOp }),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    registerRekordboxCuesIpc(host(() => undefined))
    const read = (await handler('rekordbox:trackCues')({}, '101')) as TrackCues
    const legacy = savedOp({
      id: 'c2',
      contentId: '101',
      drops: [128000],
      previousDrops: [128000],
      fingerprint: read.fingerprint,
    })
    registerRekordboxCuesIpc(host(() => legacy))
    const out = flowOutcome({
      existing: read.cues,
      drops: [128000],
      previousDrops: [128000],
      beats: read.grid.map((b) => b.ms),
      strong: read.strong,
      phrases: read.phrases,
      flow: MY_FLOW,
    })
    if (out.status !== 'plan') throw new Error('the legacy save must plan')
    expect(await handler('rekordbox:queuedCues')({}, '101')).toEqual({
      wanted: out.wanted,
      fingerprint: read.fingerprint,
    })
  })

  it('reports no queued save for an operation with neither a wanted set nor drops, which apply refuses', async () => {
    registerRekordboxCuesIpc({
      collection: () => '/c/master.db',
      queue: queue({ cuesOp: () => savedOp() }),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    expect(await handler('rekordbox:queuedCues')({}, '103')).toBeNull()
  })

  it('takes a queued save back by dropping its operation', () => {
    const drop = vi.fn<RekordboxQueue['drop']>()
    registerRekordboxCuesIpc({
      collection: () => '/c/master.db',
      queue: queue({ cuesOp: () => savedOp({ drops: [1000] }), drop }),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    handler('rekordbox:undoCues')({}, '103')
    expect(drop).toHaveBeenCalledWith('c1')
  })

  it('does nothing when no save waits for the track', () => {
    const drop = vi.fn<RekordboxQueue['drop']>()
    registerRekordboxCuesIpc({
      collection: () => '/c/master.db',
      queue: queue({ drop }),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
    })
    handler('rekordbox:undoCues')({}, '103')
    expect(drop).not.toHaveBeenCalled()
  })
})

describe('registerRekordboxCuesIpc for Engine DJ tracks', () => {
  async function engineLibrary(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'surco-enginecuesipc-'))
    writeEngineLibraryFixture(dir, {
      tracks: [{ id: 4, path: '../Music/e.mp3', title: 'e', length: 60 }],
      playlists: [],
      entities: [],
      performance: [analysedTrack(4, [{ label: 'Cue 1', sample: 44100 * 8, argb: 0xff28e214 }])],
    }).close()
    return dir
  }

  function register(
    dir: string,
    rekordbox = queue(),
    engine = queue(),
    words = vi.fn(async (_file: string) => new Uint16Array([4, 8])),
  ) {
    const applyRekordbox = quietly()
    const applyEngine = quietly()
    registerRekordboxCuesIpc({
      collection: () => '/c/master.db',
      queue: rekordbox,
      applyQuietly: applyRekordbox,
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      engine: { libraryDir: () => dir, queue: engine, applyQuietly: applyEngine, words },
    })
    return { applyRekordbox, applyEngine, words }
  }

  it('reads an Engine row’s cues from the Engine DJ library, so the editor opens on Engine tracks too', async () => {
    register(await engineLibrary())
    const read = (await handler('rekordbox:trackCues')({}, 'engine:4')) as TrackCues
    expect(read.cues).toEqual([{ id: '0', ms: 8000, kind: 1, color: 22 }])
    expect(read.analysed).toBe(true)
  })

  it('has no detailed wave for an Engine track, since Engine keeps only a coarse overview', async () => {
    register(await engineLibrary())
    expect(await handler('rekordbox:cueWaveDetail')({}, 'engine:4')).toBeNull()
  })

  it('gives Auto marcar an Engine track’s structure to detect on, from Surco’s own words when rekordbox lacks the file', async () => {
    const dir = await engineLibrary()
    const { words } = register(dir)
    const input = (await handler('rekordbox:cueDropInput')({}, 'engine:4')) as DropInput
    expect(words).toHaveBeenCalledWith(join(dir, '../Music/e.mp3'))
    expect([...input.words]).toEqual([4, 8])
    expect(input.phrases).toEqual([])
  })

  it('has no drop input for a rekordbox track, whose words the editor already reads', async () => {
    const { words } = register(await engineLibrary())
    expect(await handler('rekordbox:cueDropInput')({}, '103')).toBeNull()
    expect(words).not.toHaveBeenCalled()
  })

  it('queues each save on the library it belongs to and applies each queue, so one Save all reaches both apps', async () => {
    const rekordbox = queue()
    const engine = queue()
    const { applyRekordbox, applyEngine } = register(await engineLibrary(), rekordbox, engine)
    const req = (contentId: string) => ({
      contentId,
      path: `/m/${contentId}.wav`,
      label: contentId,
      wanted: [],
      fingerprint: 'F',
    })
    expect(await handler('rekordbox:saveCues')({}, [req('103'), req('engine:4')])).toBe('queued')
    expect(
      vi.mocked(rekordbox.enqueue).mock.calls[0][0].map((o) => (o as CuesOp).contentId),
    ).toEqual(['103'])
    expect(vi.mocked(engine.enqueue).mock.calls[0][0].map((o) => (o as CuesOp).contentId)).toEqual([
      'engine:4',
    ])
    expect(applyRekordbox).toHaveBeenCalled()
    expect(applyEngine).toHaveBeenCalled()
  })

  it('says the save belongs elsewhere when the Engine queue holds another library', async () => {
    const engine = queue({ enqueue: vi.fn<RekordboxQueue['enqueue']>(() => false) })
    const rekordbox = queue()
    const { applyEngine } = register(await engineLibrary(), rekordbox, engine)
    const req = {
      contentId: 'engine:4',
      path: '/m/e.mp3',
      label: 'e',
      wanted: [],
      fingerprint: 'F',
    }
    expect(await handler('rekordbox:saveCues')({}, [req])).toBe('other-collection')
    expect(rekordbox.enqueue).not.toHaveBeenCalled()
    expect(applyEngine).not.toHaveBeenCalled()
  })

  it('shows and takes back an Engine save from the Engine queue', async () => {
    const drop = vi.fn<RekordboxQueue['drop']>()
    const wanted = [{ id: '0', ms: 8000, kind: 1, color: 22 }]
    const engine = queue({
      cuesOp: (id) => (id === 'engine:4' ? savedOp({ contentId: 'engine:4', wanted }) : undefined),
      drop,
    })
    register(await engineLibrary(), queue(), engine)
    expect(await handler('rekordbox:queuedCues')({}, 'engine:4')).toEqual({
      wanted,
      fingerprint: 'F1',
    })
    handler('rekordbox:undoCues')({}, 'engine:4')
    expect(drop).toHaveBeenCalledWith('c1')
  })
})
