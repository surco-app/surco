import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('./rekordboxDb', async (actual) => {
  const real = await actual<typeof import('./rekordboxDb')>()
  return { ...real, openRekordboxDb: vi.fn(real.openRekordboxDb) }
})

import { CALLS_ONLY, MY_FLOW } from '../shared/cueFlows'
import { flowOutcome } from '../shared/cueRules'
import { anlzFile, pqtzSection } from './anlzFixture'
import { registerRekordboxCuesIpc } from './rekordboxCuesIpc'
import { openRekordboxDb } from './rekordboxDb'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'

function handler(channel: string): (...args: unknown[]) => unknown {
  const call = [...vi.mocked(ipcMain.handle).mock.calls].reverse().find(([n]) => n === channel)
  if (!call) throw new Error(`${channel} not registered`)
  return call[1] as (...args: unknown[]) => unknown
}

const ANLZ = '/PIONEER/USBANLZ/1/a/ANLZ0000.DAT'

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
  it('learns the flow from the marked tracks of the collection, opened read-only and never changed', async () => {
    const path = await markedCollection()
    const before = readFileSync(path)
    vi.mocked(openRekordboxDb).mockClear()
    registerRekordboxCuesIpc({
      collection: () => path,
      queue: { enqueue: vi.fn(), cuesOp: vi.fn(), drop: vi.fn() },
      applyQuietly: vi.fn(),
      flow: () => MY_FLOW,
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
      queue: { enqueue: vi.fn(), cuesOp: vi.fn(), drop: vi.fn() },
      applyQuietly: vi.fn(),
      flow: () => MY_FLOW,
    })
    expect(await handler('rekordbox:learnFlow')({})).toBeNull()
  })

  it('counts what the active flow would complete, none with Solo CALL', async () => {
    const path = await completableCollection()
    const host = (flow: () => typeof MY_FLOW) => ({
      collection: () => path,
      queue: { enqueue: vi.fn(), cuesOp: vi.fn(), drop: vi.fn() },
      applyQuietly: vi.fn(),
      flow,
    })
    registerRekordboxCuesIpc(host(() => MY_FLOW))
    expect(await handler('rekordbox:countCompletable')({})).toBe(1)
    registerRekordboxCuesIpc(host(() => CALLS_ONLY))
    expect(await handler('rekordbox:countCompletable')({})).toBe(0)
  })

  it('queues the cues and applies quietly, since "Guardar en rekordbox" never asks', async () => {
    const enqueue = vi.fn()
    const applyQuietly = vi.fn()
    registerRekordboxCuesIpc({
      collection: () => '/c/master.db',
      queue: { enqueue, cuesOp: vi.fn(), drop: vi.fn() },
      applyQuietly,
      flow: () => MY_FLOW,
    })
    const req = {
      contentId: '103',
      path: '/m/a.wav',
      label: 'a',
      wanted: [{ ms: 1000, kind: 0, color: null }],
      fingerprint: 'f',
    }
    await handler('rekordbox:saveCues')({}, req)
    expect(enqueue).toHaveBeenCalledWith([expect.objectContaining({ kind: 'cues', ...req })])
    expect(applyQuietly).toHaveBeenCalled()
  })

  it('reads nothing without a collection', async () => {
    registerRekordboxCuesIpc({
      collection: () => '',
      queue: { enqueue: vi.fn(), cuesOp: vi.fn(), drop: vi.fn() },
      applyQuietly: vi.fn(),
      flow: () => MY_FLOW,
    })
    expect(await handler('rekordbox:trackCues')({}, '103')).toBeNull()
    expect(handler('rekordbox:countCompletable')({})).toBe(0)
  })

  it('reports the cues queued for a track, or null when nothing waits or the save predates wanted sets', () => {
    const wanted = [{ ms: 1000, kind: 0, color: null }]
    const ops: Record<string, unknown> = {
      '103': { id: 'c1', wanted },
      '105': { id: 'c2', drops: [1000], previousDrops: [] },
    }
    registerRekordboxCuesIpc({
      collection: () => '/c/master.db',
      queue: { enqueue: vi.fn(), cuesOp: vi.fn((id: string) => ops[id]) as never, drop: vi.fn() },
      applyQuietly: vi.fn(),
      flow: () => MY_FLOW,
    })
    expect(handler('rekordbox:queuedCues')({}, '103')).toEqual(wanted)
    expect(handler('rekordbox:queuedCues')({}, '104')).toBeNull()
    expect(handler('rekordbox:queuedCues')({}, '105')).toBeNull()
  })

  it('takes a queued save back by dropping its operation', () => {
    const drop = vi.fn()
    registerRekordboxCuesIpc({
      collection: () => '/c/master.db',
      queue: { enqueue: vi.fn(), cuesOp: (() => ({ id: 'c1', drops: [1000] })) as never, drop },
      applyQuietly: vi.fn(),
      flow: () => MY_FLOW,
    })
    handler('rekordbox:undoCues')({}, '103')
    expect(drop).toHaveBeenCalledWith('c1')
  })

  it('does nothing when no save waits for the track', () => {
    const drop = vi.fn()
    registerRekordboxCuesIpc({
      collection: () => '/c/master.db',
      queue: { enqueue: vi.fn(), cuesOp: () => undefined, drop },
      applyQuietly: vi.fn(),
      flow: () => MY_FLOW,
    })
    handler('rekordbox:undoCues')({}, '103')
    expect(drop).not.toHaveBeenCalled()
  })
})
