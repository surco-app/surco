import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => 'window') },
}))
vi.mock('./rekordboxDb', async (actual) => {
  const real = await actual<typeof import('./rekordboxDb')>()
  return { ...real, openRekordboxDb: vi.fn(real.openRekordboxDb) }
})

import { CALLS_ONLY, MY_FLOW } from '../shared/cueFlows'
import { flowOutcome, HOT_KINDS } from '../shared/cueRules'
import type { DropInput } from '../shared/dropDetect'
import type { TrackCues } from '../shared/types'
import { anlzFile, pqtzSection, pwv5Section } from './anlzFixture'
import { registerCuesIpc } from './cuesIpc'
import { engineCueSource } from './engineCueSource'
import { analysedTrack } from './enginePerformanceFixture'
import { writeEngineLibraryFixture } from './enginePlaylistsFixture'
import { rekordboxCueSource } from './rekordboxCueSource'
import { openRekordboxDb } from './rekordboxDb'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'
import type { RekordboxQueue } from './rekordboxQueue'
import type { CuesOp } from './rekordboxQueueOps'
import { seratoCueSource } from './seratoCueSource'
import { traktorCueSource } from './traktorCueSource'
import { readTraktorTrackCues } from './traktorCues'
import { virtualdjCueSource } from './virtualdjCueSource'

function registerWithSources(host: {
  collection: () => string
  queue: Parameters<typeof rekordboxCueSource>[0]['queue']
  applyQuietly: () => void
  beginMoment?: Parameters<typeof registerCuesIpc>[0]['beginMoment']
  flow: Parameters<typeof registerCuesIpc>[0]['flow']
  beatGrid: Parameters<typeof rekordboxCueSource>[0]['beatGrid']
  words: Parameters<typeof rekordboxCueSource>[0]['words']
  fine?: Parameters<typeof rekordboxCueSource>[0]['fine']
  provisional: Parameters<typeof registerCuesIpc>[0]['provisional']
  twins: Parameters<typeof registerCuesIpc>[0]['twins']
  engine?: Parameters<typeof engineCueSource>[0]
  traktor?: Omit<Parameters<typeof traktorCueSource>[0], 'fine'>
  serato?: Omit<Parameters<typeof seratoCueSource>[0], 'words' | 'fine'>
  virtualdj?: Omit<Parameters<typeof virtualdjCueSource>[0], 'roots' | 'words'> & { dir: string }
}): void {
  registerCuesIpc({
    collection: host.collection,
    beginMoment: host.beginMoment,
    flow: host.flow,
    provisional: host.provisional,
    twins: host.twins,
    sources: {
      rekordbox: rekordboxCueSource(host),
      traktor: host.traktor
        ? traktorCueSource({ ...host.traktor, fine: host.fine }, host.collection, host.beatGrid)
        : null,
      engine: host.engine ? engineCueSource(host.engine, host.collection, host.beatGrid) : null,
      serato: host.serato
        ? seratoCueSource({ ...host.serato, words: host.words, fine: host.fine }, host.collection)
        : null,
      virtualdj: host.virtualdj
        ? virtualdjCueSource(
            {
              ...host.virtualdj,
              roots: () => [{ dir: host.virtualdj?.dir ?? '', root: '/' }],
              words: host.words,
            },
            host.collection,
          )
        : null,
    },
  })
}

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

describe('registerCuesIpc', () => {
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
    registerWithSources({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    const words = (await handler('cues:waveDetail')({}, '101')) as Uint16Array
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
    registerWithSources({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    expect(await handler('cues:waveDetail')({}, '101')).toBeNull()
  })

  it('has no detail for a track without PWV5, an unknown track or no collection', async () => {
    const path = await detailCollection(false)
    registerWithSources({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    expect(await handler('cues:waveDetail')({}, '101')).toBeNull()
    expect(await handler('cues:waveDetail')({}, '999')).toBeNull()
    registerWithSources({
      collection: () => '',
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    expect(await handler('cues:waveDetail')({}, '101')).toBeNull()
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
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    registerWithSources(host(() => MY_FLOW))
    expect(await handler('rekordbox:countCompletable')({})).toBe(1)
    registerWithSources(host(() => CALLS_ONLY))
    expect(await handler('rekordbox:countCompletable')({})).toBe(0)
  })

  it('queues the cues and applies quietly, since "Guardar en rekordbox" never asks', async () => {
    const enqueue = vi.fn<RekordboxQueue['enqueue']>(() => true)
    const applyQuietly = quietly()
    registerWithSources({
      collection: () => '/c/master.db',
      queue: queue({ enqueue }),
      applyQuietly,
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    const req = {
      contentId: '103',
      path: '/m/a.wav',
      label: 'a',
      wanted: [{ ms: 1000, kind: 0, color: null }],
      fingerprint: 'f',
    }
    await handler('cues:save')({}, [req])
    expect(enqueue).toHaveBeenCalledWith([expect.objectContaining({ kind: 'cues', ...req })])
    expect(applyQuietly).toHaveBeenCalled()
  })

  it('saving cues starts a cues momento before anything is queued, so the copy is labelled for the cue save', async () => {
    const order: string[] = []
    const beginMoment = vi.fn((r: string) => order.push(`begin:${r}`))
    const enqueue = vi.fn<RekordboxQueue['enqueue']>(() => {
      order.push('enqueue')
      return true
    })
    registerWithSources({
      collection: () => '/c/master.db',
      queue: queue({ enqueue }),
      applyQuietly: quietly(),
      beginMoment,
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    await handler('cues:save')({}, [
      {
        contentId: '103',
        path: '/m/a.wav',
        label: 'a',
        wanted: [{ ms: 1000, kind: 0, color: null }],
        fingerprint: 'f',
      },
    ])
    expect(order).toEqual(['begin:cues', 'enqueue'])
    expect(beginMoment).toHaveBeenCalledWith('cues', ['rekordbox'])
  })

  it('a cue save starts a momento only in the programs it writes, so the others keep theirs', async () => {
    const beginMoment = vi.fn()
    registerWithSources({
      collection: () => '/c/master.db',
      queue: queue(),
      applyQuietly: quietly(),
      beginMoment,
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
      engine: {
        libraryDir: () => '/e',
        queue: queue(),
        applyQuietly: quietly(),
        words: async () => null,
      },
    })
    await handler('cues:save')({}, [
      {
        contentId: 'engine:4',
        path: '/m/e.mp3',
        label: 'e',
        wanted: [{ ms: 1000, kind: 0, color: null }],
        fingerprint: 'f',
      },
    ])
    expect(beginMoment).toHaveBeenCalledWith('cues', ['engine'])
  })

  it('never queues an Engine track’s cues on rekordbox when Engine is not wired', async () => {
    const enqueue = vi.fn<RekordboxQueue['enqueue']>(() => true)
    const beginMoment = vi.fn()
    registerWithSources({
      collection: () => '/c/master.db',
      queue: queue({ enqueue }),
      applyQuietly: quietly(),
      beginMoment,
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    await expect(
      handler('cues:save')({}, [
        {
          contentId: 'engine:4',
          path: '/m/e.mp3',
          label: 'e',
          wanted: [{ ms: 1000, kind: 0, color: null }],
          fingerprint: 'f',
        },
      ]),
    ).rejects.toThrow('engine has no cue source')
    expect(enqueue).not.toHaveBeenCalled()
    expect(beginMoment).not.toHaveBeenCalled()
  })

  it('never queues a Traktor track’s cues on rekordbox when Traktor is not wired', async () => {
    const enqueue = vi.fn<RekordboxQueue['enqueue']>(() => true)
    const beginMoment = vi.fn()
    registerWithSources({
      collection: () => '/c/master.db',
      queue: queue({ enqueue }),
      applyQuietly: quietly(),
      beginMoment,
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    await expect(
      handler('cues:save')({}, [
        {
          contentId: 'traktor:HD/:Music/:t.aiff',
          path: '/Music/t.aiff',
          label: 't',
          wanted: [{ ms: 1000, kind: 0, color: null }],
          fingerprint: 'f',
        },
      ]),
    ).rejects.toThrow('traktor has no cue source')
    expect(enqueue).not.toHaveBeenCalled()
    expect(beginMoment).not.toHaveBeenCalled()
  })

  it('refuses a save that mixes a program with no cue source and a wired one, so nothing from the call is written', async () => {
    const enqueue = vi.fn<RekordboxQueue['enqueue']>(() => true)
    const applyQuietly = quietly()
    const beginMoment = vi.fn()
    const add = vi.fn()
    registerWithSources({
      collection: () => '/c/master.db',
      queue: queue({ enqueue }),
      applyQuietly,
      beginMoment,
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add },
      twins: async () => ({}),
    })
    const wanted = [{ ms: 1000, kind: 0, color: null }]
    await expect(
      handler('cues:save')({}, [
        {
          contentId: '103',
          path: '/m/a.wav',
          label: 'a',
          wanted,
          fingerprint: 'f',
          provisional: true,
        },
        { contentId: 'engine:4', path: '/m/e.mp3', label: 'e', wanted, fingerprint: 'f' },
      ]),
    ).rejects.toThrow('engine has no cue source')
    expect(enqueue).not.toHaveBeenCalled()
    expect(applyQuietly).not.toHaveBeenCalled()
    expect(beginMoment).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })

  it('routes a mixed rekordbox and VirtualDJ save to each program’s own queue, and opens a copy moment only for rekordbox', async () => {
    const enqueue = vi.fn<RekordboxQueue['enqueue']>(() => true)
    const applyQuietly = quietly()
    const vdjEnqueue = vi.fn<RekordboxQueue['enqueue']>(() => true)
    const vdjApply = quietly()
    const beginMoment = vi.fn()
    registerWithSources({
      collection: () => '/c/master.db',
      queue: queue({ enqueue }),
      applyQuietly,
      beginMoment,
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
      virtualdj: {
        dir: join(__dirname, 'virtualdjFixtures'),
        queue: queue({ enqueue: vdjEnqueue }),
        applyQuietly: vdjApply,
      },
    })
    const vdj = 'virtualdj:/Music/VirtualDJ Pruebas/Pray.mp3'
    expect((await handler('cues:trackCues')({}, vdj)) as TrackCues).toMatchObject({
      contentId: vdj,
    })
    const wanted = [{ ms: 1000, kind: HOT_KINDS[0], color: null }]
    await handler('cues:save')({}, [
      { contentId: '103', path: '/m/a.wav', label: 'a', wanted, fingerprint: 'f' },
      { contentId: vdj, path: '/m/v.mp3', label: 'v', wanted, fingerprint: 'f' },
    ])
    expect(vdjEnqueue).toHaveBeenCalledTimes(1)
    expect(vdjEnqueue).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'cues', contentId: vdj, wanted }),
    ])
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'cues', contentId: '103', wanted }),
    ])
    expect(vdjApply).toHaveBeenCalledTimes(1)
    expect(applyQuietly).toHaveBeenCalledTimes(1)
    expect(beginMoment).toHaveBeenCalledWith('cues', ['rekordbox'])
  })

  it('queues several tracks together and applies once, so master.db is written in one batch', async () => {
    const enqueue = vi.fn<RekordboxQueue['enqueue']>(() => true)
    const applyQuietly = quietly()
    registerWithSources({
      collection: () => '/c/master.db',
      queue: queue({ enqueue }),
      applyQuietly,
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    const req = (contentId: string) => ({
      contentId,
      path: `/m/${contentId}.wav`,
      label: contentId,
      wanted: [{ ms: 1000, kind: 0, color: null }],
      fingerprint: 'f',
    })
    await handler('cues:save')({}, [req('103'), req('104')])
    expect(enqueue).toHaveBeenCalledTimes(1)
    const [ops] = enqueue.mock.calls[0]
    expect(ops.map((o) => (o.kind === 'cues' ? o.contentId : null))).toEqual(['103', '104'])
    expect(new Set(ops.map((o) => o.id)).size).toBe(2)
    expect(applyQuietly).toHaveBeenCalledTimes(1)
  })

  it('tells the editor how far rekordbox runs ahead of what it plays on a LAME MP3, so a cue set by ear lands where it was heard', async () => {
    const path = await collectionWithMp3('LAME')
    registerWithSources({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    expect(await handler('cues:auditionLead')({}, '101')).toBeCloseTo((1152 / 44100) * 1000, 3)
  })

  it('gives no lead for an MP3 the editor already plays in step with rekordbox', async () => {
    const path = await collectionWithMp3('Lavc')
    registerWithSources({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    expect(await handler('cues:auditionLead')({}, '101')).toBe(0)
  })

  it('gives no lead for a track the collection does not hold', async () => {
    const path = await collectionWithMp3('LAME')
    registerWithSources({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    expect(await handler('cues:auditionLead')({}, '999')).toBe(0)
  })

  it('lays a grid of its own on a track rekordbox has not analysed, in rekordbox time, so the editor can place cues without opening rekordbox', async () => {
    const path = await collectionWithMp3('LAME')
    const beatGrid = vi.fn(async () => ({ bpm: 120, firstMs: 100 }))
    registerWithSources({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid,
      words: async () => Uint16Array.from([7, 8, 9]),
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    const out = (await handler('cues:surcoGrid')({}, '101')) as {
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

  it('fits the grid of an analysed WAV on rekordbox time, where the beat sits 2 ms after the rise like the provisional grid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surco-rbfit-'))
    const path = join(dir, 'master.db')
    writeRekordboxPlaylistFixture(path, {
      ...ORGANISE_FIXTURE,
      content: ORGANISE_FIXTURE.content.map((c) =>
        c.ID === '101' ? { ...c, FolderPath: join(dir, 'track.wav') } : c,
      ),
    })
    registerWithSources({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => ({ bpm: 150, firstMs: 10 }),
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    expect(await handler('cues:gridFit')({}, '101')).toEqual({ bpm: 150, firstMs: 12 })
  })

  it('moves the phases measured along the track onto rekordbox time too, so the offset near the playhead is in its clock', async () => {
    const path = await collectionWithMp3('LAME')
    registerWithSources({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => ({ bpm: 120, firstMs: 100, phases: [{ ms: 6000, firstMs: 125 }] }),
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    const out = (await handler('cues:gridFit')({}, '101')) as {
      phases: { ms: number; firstMs: number }[]
    }
    const lead = ((1152 + 576 + 529) / 44100) * 1000 + 2
    expect(out.phases[0].ms).toBeCloseTo(6000 + lead, 3)
    expect(out.phases[0].firstMs).toBeCloseTo(125 + lead, 3)
  })

  it('moves the fit of a LAME MP3 by the frames rekordbox skips, so Auto lands on its beats and not 51 ms early', async () => {
    const path = await collectionWithMp3('LAME')
    registerWithSources({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => ({ bpm: 120, firstMs: 100 }),
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    const out = (await handler('cues:gridFit')({}, '101')) as { bpm: number; firstMs: number }
    expect(out.bpm).toBe(120)
    expect(out.firstMs).toBeCloseTo(100 + ((1152 + 576 + 529) / 44100) * 1000 + 2, 3)
  })

  it('measures for the bad-grid filter behind whatever the DJ opens, and for Auto ahead of it', async () => {
    const path = await completableCollection()
    const beatGrid = vi.fn(async () => ({ bpm: 120, firstMs: 0 }))
    registerWithSources({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    await handler('cues:gridVerdict')({}, '101')
    expect(beatGrid).toHaveBeenLastCalledWith(expect.any(String), 'low')
    await handler('cues:gridFit')({}, '101')
    expect(beatGrid).toHaveBeenLastCalledWith(expect.any(String), 'high')
  })

  it('judges the rekordbox grid of a track against the beats Surco measured, for the filter of bad grids', async () => {
    const path = await completableCollection()
    const phases = Array.from({ length: 40 }, (_, i) => ({ ms: 3200 + i * 6400, firstMs: 90 }))
    registerWithSources({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => ({ bpm: 120, firstMs: 90, phases }),
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    expect(await handler('cues:gridVerdict')({}, '101')).toEqual({ kind: 'shifted', ms: -92 })
    expect(await handler('cues:gridVerdict')({}, 'engine:4')).toBeNull()
  })

  it('fits nothing when Surco hears no beat or the track is not in the collection', async () => {
    const path = await collectionWithMp3('LAME')
    const beatGrid = vi.fn(async () => null)
    registerWithSources({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    expect(await handler('cues:gridFit')({}, '101')).toBeNull()
    expect(await handler('cues:gridFit')({}, '999')).toBeNull()
    expect(beatGrid).toHaveBeenCalledTimes(1)
  })

  it('draws the wave Surco measured, moved into rekordbox time so the kick sits on its beat line', async () => {
    const path = await collectionWithMp3('LAME')
    registerWithSources({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => ({ bpm: 120, firstMs: 100 }),
      words: async () => Uint16Array.from([7, 8, 9]),
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    const out = (await handler('cues:surcoGrid')({}, '101')) as { words: Uint16Array }
    const lead = Math.round((((1152 + 576 + 529) / 44100) * 1000 * 150) / 1000)
    expect(Array.from(out.words)).toEqual([...Array(lead).fill(0), 7, 8, 9])
  })

  it('offers no grid for a track Surco hears no beat in', async () => {
    const path = await collectionWithMp3('LAME')
    registerWithSources({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    expect(await handler('cues:surcoGrid')({}, '101')).toBeNull()
  })

  it('offers no grid for a track the collection does not hold, without decoding anything', async () => {
    const path = await collectionWithMp3('LAME')
    const beatGrid = vi.fn(async () => ({ bpm: 120, firstMs: 100 }))
    registerWithSources({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    expect(await handler('cues:surcoGrid')({}, '999')).toBeNull()
    expect(beatGrid).not.toHaveBeenCalled()
  })

  it("remembers a save made on Surco's grid, so the cues can be moved onto rekordbox's once it analyses the track", () => {
    const add = vi.fn()
    registerWithSources({
      collection: () => '/c/master.db',
      queue: queue({ enqueue: vi.fn(() => true) }),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add },
      twins: async () => ({}),
    })
    const wanted = [{ ms: 1000, kind: 0, color: null }]
    handler('cues:save')({}, [
      {
        contentId: '103',
        path: '/m/a.wav',
        label: 'a',
        wanted,
        fingerprint: 'F',
        provisional: true,
      },
      { contentId: '104', path: '/m/b.wav', label: 'b', wanted, fingerprint: 'F' },
    ])
    expect(add).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledWith({ contentId: '103', label: 'a', wanted })
  })

  it('reads nothing without a collection', async () => {
    registerWithSources({
      collection: () => '',
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    expect(await handler('cues:trackCues')({}, '103')).toBeNull()
    expect(handler('rekordbox:countCompletable')({})).toBe(0)
    expect(await handler('cues:auditionLead')({}, '103')).toBe(0)
  })

  it('reports the cues queued for a track with the fingerprint they were built on, or null when nothing waits', () => {
    const wanted = [{ ms: 1000, kind: 0, color: null }]
    const queued = savedOp({ wanted })
    registerWithSources({
      collection: () => '/c/master.db',
      queue: queue({ cuesOp: (id) => (id === '103' ? queued : undefined) }),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    return Promise.all([
      expect(handler('cues:queued')({}, '103')).resolves.toEqual({
        wanted,
        fingerprint: 'F1',
      }),
      expect(handler('cues:queued')({}, '104')).resolves.toBeNull(),
    ])
  })

  it('reports the grid queued with the cues, so the editor shows the grid that will be written', async () => {
    const wanted = [{ ms: 1000, kind: 0, color: null }]
    const grid = { bpm: 120.5, anchorMs: 40 }
    const queued = savedOp({ wanted, grid, gridFingerprint: 'g0' })
    registerWithSources({
      collection: () => '/c/master.db',
      queue: queue({ cuesOp: (id) => (id === '103' ? queued : undefined) }),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    expect(await handler('cues:queued')({}, '103')).toEqual({
      wanted,
      fingerprint: 'F1',
      grid,
      gridFingerprint: 'g0',
    })
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
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    registerWithSources(host(() => undefined))
    const read = (await handler('cues:trackCues')({}, '101')) as TrackCues
    const legacy = savedOp({
      id: 'c2',
      contentId: '101',
      drops: [128000],
      previousDrops: [128000],
      fingerprint: read.fingerprint,
    })
    registerWithSources(host(() => legacy))
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
    expect(await handler('cues:queued')({}, '101')).toEqual({
      wanted: out.wanted,
      fingerprint: read.fingerprint,
    })
  })

  it('reports no queued save for an operation with neither a wanted set nor drops, which apply refuses', async () => {
    registerWithSources({
      collection: () => '/c/master.db',
      queue: queue({ cuesOp: () => savedOp() }),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    expect(await handler('cues:queued')({}, '103')).toBeNull()
  })

  it('takes a queued save back by dropping its operation', () => {
    const drop = vi.fn<RekordboxQueue['drop']>()
    registerWithSources({
      collection: () => '/c/master.db',
      queue: queue({ cuesOp: () => savedOp({ drops: [1000] }), drop }),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    handler('cues:undo')({}, '103')
    expect(drop).toHaveBeenCalledWith('c1')
  })

  it('does nothing when no save waits for the track', () => {
    const drop = vi.fn<RekordboxQueue['drop']>()
    registerWithSources({
      collection: () => '/c/master.db',
      queue: queue({ drop }),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
    })
    handler('cues:undo')({}, '103')
    expect(drop).not.toHaveBeenCalled()
  })
})

describe('registerCuesIpc for Engine DJ tracks', () => {
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
    registerWithSources({
      collection: () => '/c/master.db',
      queue: rekordbox,
      applyQuietly: applyRekordbox,
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
      engine: { libraryDir: () => dir, queue: engine, applyQuietly: applyEngine, words },
    })
    return { applyRekordbox, applyEngine, words }
  }

  it('reads an Engine row’s cues from the Engine DJ library, so the editor opens on Engine tracks too', async () => {
    register(await engineLibrary())
    const read = (await handler('cues:trackCues')({}, 'engine:4')) as TrackCues
    expect(read.cues).toEqual([{ id: '0', ms: 8000, kind: 1, color: 22 }])
    expect(read.analysed).toBe(true)
  })

  it('has no detailed wave for an Engine track, since Engine keeps only a coarse overview', async () => {
    register(await engineLibrary())
    expect(await handler('cues:waveDetail')({}, 'engine:4')).toBeNull()
  })

  it('gives Auto marcar an Engine track’s structure to detect on, from Surco’s own words when rekordbox lacks the file', async () => {
    const dir = await engineLibrary()
    const { words } = register(dir)
    const input = (await handler('cues:dropInput')({}, 'engine:4')) as DropInput
    expect(words).toHaveBeenCalledWith(join(dir, '../Music/e.mp3'))
    expect([...input.words]).toEqual([4, 8])
    expect(input.phrases).toEqual([])
  })

  it('has no drop input for a rekordbox track, whose words the editor already reads', async () => {
    const { words } = register(await engineLibrary())
    expect(await handler('cues:dropInput')({}, '103')).toBeNull()
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
    await handler('cues:save')({}, [req('103'), req('engine:4')])
    expect(
      vi.mocked(rekordbox.enqueue).mock.calls[0][0].map((o) => (o as CuesOp).contentId),
    ).toEqual(['103'])
    expect(vi.mocked(engine.enqueue).mock.calls[0][0].map((o) => (o as CuesOp).contentId)).toEqual([
      'engine:4',
    ])
    expect(applyRekordbox).toHaveBeenCalled()
    expect(applyEngine).toHaveBeenCalled()
  })

  it('shows and takes back an Engine save from the Engine queue', async () => {
    const drop = vi.fn<RekordboxQueue['drop']>()
    const wanted = [{ id: '0', ms: 8000, kind: 1, color: 22 }]
    const engine = queue({
      cuesOp: (id) => (id === 'engine:4' ? savedOp({ contentId: 'engine:4', wanted }) : undefined),
      drop,
    })
    register(await engineLibrary(), queue(), engine)
    expect(await handler('cues:queued')({}, 'engine:4')).toEqual({
      wanted,
      fingerprint: 'F1',
    })
    handler('cues:undo')({}, 'engine:4')
    expect(drop).toHaveBeenCalledWith('c1')
  })
})

describe('registerCuesIpc for Traktor tracks', () => {
  const ID = 'traktor:HD/:Music/:t.aiff'
  const NML = `<NML VERSION="20"><COLLECTION ENTRIES="1"><ENTRY TITLE="t"><LOCATION DIR="/:Music/:" FILE="t.aiff" VOLUME="HD" VOLUMEID="v"></LOCATION><INFO PLAYTIME_FLOAT="60.0"></INFO><CUE_V2 NAME="AutoGrid" TYPE="4" START="0.000000" LEN="0" REPEATS="-1" HOTCUE="-1"><GRID BPM="120.000000"></GRID></CUE_V2><CUE_V2 NAME="n.n." TYPE="0" START="8000.000000" LEN="0" REPEATS="-1" HOTCUE="1"></CUE_V2></ENTRY></COLLECTION></NML>`

  async function collectionFile(): Promise<string> {
    const file = join(await mkdtemp(join(tmpdir(), 'surco-traktorcuesipc-')), 'collection.nml')
    writeFileSync(file, NML)
    return file
  }

  function register(
    nml: string,
    rekordbox = queue(),
    traktor = queue(),
    words = vi.fn(async (_file: string) => new Uint16Array([4, 8])),
  ) {
    const applyTraktor = quietly()
    registerWithSources({
      collection: () => '',
      queue: rekordbox,
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
      traktor: {
        nml: () => nml,
        bootVolume: () => 'HD',
        queue: traktor,
        applyQuietly: applyTraktor,
        words,
      },
    })
    return { applyTraktor, words }
  }

  it('reads a Traktor row’s cues from the collection the tab reads, so the editor opens on Traktor tracks', async () => {
    register(await collectionFile())
    const read = (await handler('cues:trackCues')({}, ID)) as TrackCues
    expect(read.cues).toEqual([{ id: '1', ms: 8000, kind: 1, color: expect.any(Number) }])
    expect(read.analysed).toBe(true)
  })

  it('draws the zoomed wave from the audio of the file, since Traktor keeps none Surco can read', async () => {
    const { words } = register(await collectionFile())
    expect([...((await handler('cues:waveDetail')({}, ID)) as Uint16Array)]).toEqual([4, 8])
    expect(words).toHaveBeenCalledWith('/Music/t.aiff')
  })

  it('gives Auto mark the Traktor grid and the audio words when rekordbox lacks the file', async () => {
    register(await collectionFile())
    const input = (await handler('cues:dropInput')({}, ID)) as DropInput
    expect(input.phrases).toEqual([])
    expect(input.grid[1]).toEqual({ ms: 500, beat: 2 })
  })

  // Traktor only reads its collection when it starts, so a save made while it is open
  // would wait unseen: the save asks to close Traktor over the window that made it.
  it('queues a Traktor save on the Traktor queue and applies it there, asking over the window that saved', async () => {
    const rekordbox = queue()
    const traktor = queue()
    const { applyTraktor } = register(await collectionFile(), rekordbox, traktor)
    const req = { contentId: ID, path: '/Music/t.aiff', label: 't', wanted: [], fingerprint: 'F' }
    await handler('cues:save')({ sender: {} }, [req])
    expect(vi.mocked(traktor.enqueue).mock.calls[0][0].map((o) => (o as CuesOp).contentId)).toEqual(
      [ID],
    )
    expect(rekordbox.enqueue).not.toHaveBeenCalled()
    expect(applyTraktor).toHaveBeenCalledWith('window')
  })

  it('shows and takes back a Traktor save from the Traktor queue', async () => {
    const drop = vi.fn<RekordboxQueue['drop']>()
    const wanted = [{ id: '1', ms: 8000, kind: 1, color: 1 }]
    const traktor = queue({
      cuesOp: (id) => (id === ID ? savedOp({ contentId: ID, wanted }) : undefined),
      drop,
    })
    register(await collectionFile(), queue(), traktor)
    expect(await handler('cues:queued')({}, ID)).toEqual({ wanted, fingerprint: 'F1' })
    handler('cues:undo')({}, ID)
    expect(drop).toHaveBeenCalledWith('c1')
  })

  describe('with every program wired, as the app wires them', () => {
    async function registerAll(
      over: {
        rekordbox?: ReturnType<typeof queue>
        engine?: ReturnType<typeof queue>
        traktor?: ReturnType<typeof queue>
        beatGrid?: (file: string) => Promise<{
          bpm: number
          firstMs: number
          phases?: { ms: number; firstMs: number }[]
        } | null>
      } = {},
    ) {
      const nml = await collectionFile()
      const traktorWords = vi.fn(async (_file: string) => new Uint16Array([4, 8]))
      const engineWords = vi.fn(async (_file: string) => new Uint16Array([1, 2]))
      const beatGrid = vi.fn(over.beatGrid ?? (async () => ({ bpm: 120, firstMs: 100 })))
      registerWithSources({
        collection: () => '/no/master.db',
        queue: over.rekordbox ?? queue(),
        applyQuietly: quietly(),
        flow: () => MY_FLOW,
        beatGrid,
        words: async () => null,
        provisional: { add: vi.fn() },
        twins: async () => ({}),
        engine: {
          libraryDir: () => '/no/engine',
          queue: over.engine ?? queue(),
          applyQuietly: quietly(),
          words: engineWords,
        },
        traktor: {
          nml: () => nml,
          bootVolume: () => 'HD',
          queue: over.traktor ?? queue(),
          applyQuietly: quietly(),
          words: traktorWords,
        },
      })
      return { nml, traktorWords, engineWords, beatGrid }
    }

    it('reads a Traktor track’s cues from the NML, not from rekordbox', async () => {
      const { nml } = await registerAll()
      const read = await handler('cues:trackCues')({}, ID)
      expect(read).not.toBeNull()
      expect(read).toEqual({
        ...readTraktorTrackCues(readFileSync(nml, 'utf8'), ID),
        clockLeadMs: 0,
      })
    })

    it('draws a Traktor track’s detailed wave from its file', async () => {
      const { traktorWords, engineWords } = await registerAll()
      expect([...((await handler('cues:waveDetail')({}, ID)) as Uint16Array)]).toEqual([4, 8])
      expect(traktorWords).toHaveBeenCalledWith('/Music/t.aiff')
      expect(engineWords).not.toHaveBeenCalled()
    })

    it('gives a rekordbox track no drop input', async () => {
      const { traktorWords, engineWords } = await registerAll()
      expect(await handler('cues:dropInput')({}, '123')).toBeNull()
      expect(traktorWords).not.toHaveBeenCalled()
      expect(engineWords).not.toHaveBeenCalled()
    })

    it('leads no audition for a Traktor or Engine track', async () => {
      await registerAll()
      expect(await handler('cues:auditionLead')({}, ID)).toBe(0)
      expect(await handler('cues:auditionLead')({}, 'engine:4')).toBe(0)
    })

    it('fits the grid of an uncompressed Traktor file on the clock Surco draws, as rekordbox does for PCM', async () => {
      const { beatGrid } = await registerAll()
      expect(await handler('cues:gridFit')({}, ID)).toMatchObject({ bpm: 120, firstMs: 102 })
      expect(beatGrid).toHaveBeenLastCalledWith(expect.stringMatching(/t\.aiff$/), 'high')
      expect(await handler('cues:gridFit')({}, 'engine:4')).toBeNull()
    })

    it('judges the grid of an uncompressed Traktor file for the bad-grid filter, measuring at low priority', async () => {
      const phases = Array.from({ length: 40 }, (_, i) => ({ ms: 3200 + i * 6400, firstMs: 0 }))
      const { beatGrid } = await registerAll({
        beatGrid: async () => ({ bpm: 120, firstMs: 0, phases }),
      })
      await handler('cues:gridVerdict')({}, ID)
      expect(beatGrid).toHaveBeenLastCalledWith(expect.stringMatching(/t\.aiff$/), 'low')
    })

    it('builds no Surco grid for a Traktor or Engine track', async () => {
      const { beatGrid } = await registerAll()
      expect(await handler('cues:surcoGrid')({}, ID)).toBeNull()
      expect(await handler('cues:surcoGrid')({}, 'engine:4')).toBeNull()
      expect(beatGrid).not.toHaveBeenCalled()
    })

    it('answers a queued Traktor or Engine op without wanted cues with an empty list', async () => {
      const traktor = queue({
        cuesOp: (id) => (id === ID ? savedOp({ contentId: ID, drops: [8000] }) : undefined),
      })
      const engine = queue({
        cuesOp: (id) =>
          id === 'engine:4'
            ? savedOp({ contentId: 'engine:4', drops: [8000], fingerprint: 'F2' })
            : undefined,
      })
      await registerAll({ traktor, engine })
      expect(await handler('cues:queued')({}, ID)).toEqual({
        wanted: [],
        fingerprint: 'F1',
      })
      expect(await handler('cues:queued')({}, 'engine:4')).toEqual({
        wanted: [],
        fingerprint: 'F2',
      })
    })

    it('undoes a Traktor track’s cues on the Traktor queue', async () => {
      const rekordbox = queue({ cuesOp: () => savedOp({ id: 'r1', drops: [1000] }) })
      const engine = queue({ cuesOp: () => savedOp({ id: 'e1', drops: [1000] }) })
      const traktor = queue({
        cuesOp: (id) => (id === ID ? savedOp({ contentId: ID, drops: [1000] }) : undefined),
      })
      await registerAll({ rekordbox, engine, traktor })
      handler('cues:undo')({}, ID)
      expect(traktor.drop).toHaveBeenCalledWith('c1')
      expect(rekordbox.drop).not.toHaveBeenCalled()
      expect(engine.drop).not.toHaveBeenCalled()
    })
  })
})

describe('cues:twins', () => {
  it('answers with the same file in each program the cue editor writes to', async () => {
    const twins = vi.fn(async (_file: string) => ({ rekordbox: '101', traktor: 'traktor:k' }))
    registerWithSources({
      collection: () => '',
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words: async () => null,
      provisional: { add: vi.fn() },
      twins,
    })
    expect(await handler('cues:twins')({}, '/m/a.aiff')).toEqual({
      rekordbox: '101',
      traktor: 'traktor:k',
    })
    expect(twins).toHaveBeenCalledWith('/m/a.aiff')
  })
})

describe('registerCuesIpc for Serato tracks', () => {
  const ID = 'serato:/Music/gone/s.mp3'
  const saveOf = (contentId: string) => ({
    contentId,
    path: '/Music/gone/s.mp3',
    label: 's',
    wanted: [{ ms: 1000, kind: 1, color: null }],
    fingerprint: 'f',
  })

  function register(serato = queue()) {
    const order: string[] = []
    const track = (name: string) =>
      vi.fn<RekordboxQueue['enqueue']>(() => {
        order.push(name)
      })
    const queues = {
      rekordbox: queue({ cuesOp: () => savedOp(), enqueue: track('rekordbox') }),
      engine: queue(),
      traktor: queue(),
      serato: { ...serato, enqueue: track('serato') },
    }
    const beginMoment = vi.fn()
    const applySerato = quietly()
    const words = vi.fn(async () => new Uint16Array([5, 6]))
    registerWithSources({
      collection: () => '/c/master.db',
      queue: queues.rekordbox,
      applyQuietly: quietly(),
      beginMoment,
      flow: () => MY_FLOW,
      beatGrid: async () => null,
      words,
      provisional: { add: vi.fn() },
      twins: async () => ({}),
      engine: {
        libraryDir: () => '/e',
        queue: queues.engine,
        applyQuietly: quietly(),
        words: async () => null,
      },
      traktor: {
        nml: () => '',
        bootVolume: () => 'HD',
        queue: queues.traktor,
        applyQuietly: quietly(),
        words: async () => null,
      },
      serato: { queue: queues.serato, applyQuietly: applySerato },
    })
    return { queues, beginMoment, words, applySerato, order }
  }

  it('reads a Serato row from its own file, answering nothing when the file is gone', async () => {
    register()
    expect(await handler('cues:trackCues')({}, ID)).toBeNull()
  })

  it('draws a Serato track’s zoomed wave from the audio of its file', async () => {
    const { words } = register()
    expect([...((await handler('cues:waveDetail')({}, ID)) as Uint16Array)]).toEqual([5, 6])
    expect(words).toHaveBeenCalledWith('/Music/gone/s.mp3')
  })

  it('queues a Serato track’s cues on the Serato queue and writes them quietly, with no library copy moment, since the file keeps its own original', async () => {
    const { queues, beginMoment, applySerato } = register()
    await handler('cues:save')({ sender: {} }, [saveOf(ID)])
    expect(
      vi.mocked(queues.serato.enqueue).mock.calls[0][0].map((o) => (o as CuesOp).contentId),
    ).toEqual([ID])
    for (const q of [queues.rekordbox, queues.engine, queues.traktor])
      expect(q.enqueue).not.toHaveBeenCalled()
    expect(applySerato).toHaveBeenCalled()
    expect(beginMoment).not.toHaveBeenCalled()
  })

  it('saves Serato after the other programs in one Save all, and opens the copy moment only for those with a library', async () => {
    const { order, beginMoment } = register()
    await handler('cues:save')({ sender: {} }, [saveOf(ID), saveOf('103')])
    expect(order).toEqual(['rekordbox', 'serato'])
    expect(beginMoment).toHaveBeenCalledWith('cues', ['rekordbox'])
  })

  it('shows and takes back a Serato save from the Serato queue, and never the rekordbox one', async () => {
    const wanted = [{ id: '0', ms: 8000, kind: 1, color: 22 }]
    const drop = vi.fn<RekordboxQueue['drop']>()
    const { queues } = register(
      queue({
        cuesOp: (id) => (id === ID ? savedOp({ id: 's1', contentId: ID, wanted }) : undefined),
        drop,
      }),
    )
    expect(await handler('cues:queued')({}, ID)).toEqual({ wanted, fingerprint: 'F1' })
    await handler('cues:undo')({}, ID)
    expect(drop).toHaveBeenCalledWith('s1')
    expect(queues.rekordbox.drop).not.toHaveBeenCalled()
  })
})
