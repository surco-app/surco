import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { CALLS_ONLY, MY_FLOW } from '../shared/cueFlows'
import { anlzFile, pqtzSection } from './anlzFixture'
import { registerRekordboxCuesIpc } from './rekordboxCuesIpc'
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

describe('registerRekordboxCuesIpc', () => {
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
