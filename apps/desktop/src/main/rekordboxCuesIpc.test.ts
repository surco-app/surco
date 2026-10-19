import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { registerRekordboxCuesIpc } from './rekordboxCuesIpc'

function handler(channel: string): (...args: unknown[]) => unknown {
  const call = [...vi.mocked(ipcMain.handle).mock.calls].reverse().find(([n]) => n === channel)
  if (!call) throw new Error(`${channel} not registered`)
  return call[1] as (...args: unknown[]) => unknown
}

describe('registerRekordboxCuesIpc', () => {
  it('queues the cues and applies quietly, since "Guardar en rekordbox" never asks', async () => {
    const enqueue = vi.fn()
    const applyQuietly = vi.fn()
    registerRekordboxCuesIpc({
      collection: () => '/c/master.db',
      queue: { enqueue, cuesOp: vi.fn(), drop: vi.fn() },
      applyQuietly,
    })
    const req = {
      contentId: '103',
      path: '/m/a.wav',
      label: 'a',
      drops: [1000],
      previousDrops: [],
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
    })
    expect(await handler('rekordbox:trackCues')({}, '103')).toBeNull()
    expect(handler('rekordbox:countCompletable')({})).toBe(0)
  })

  it('reports the drops queued for a track, or null when nothing waits', () => {
    const cuesOp = vi.fn((id: string) => (id === '103' ? { id: 'c1', drops: [1000] } : undefined))
    registerRekordboxCuesIpc({
      collection: () => '/c/master.db',
      queue: { enqueue: vi.fn(), cuesOp: cuesOp as never, drop: vi.fn() },
      applyQuietly: vi.fn(),
    })
    expect(handler('rekordbox:queuedCues')({}, '103')).toEqual([1000])
    expect(handler('rekordbox:queuedCues')({}, '104')).toBeNull()
  })

  it('takes a queued save back by dropping its operation', () => {
    const drop = vi.fn()
    registerRekordboxCuesIpc({
      collection: () => '/c/master.db',
      queue: { enqueue: vi.fn(), cuesOp: (() => ({ id: 'c1', drops: [1000] })) as never, drop },
      applyQuietly: vi.fn(),
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
    })
    handler('rekordbox:undoCues')({}, '103')
    expect(drop).not.toHaveBeenCalled()
  })
})
