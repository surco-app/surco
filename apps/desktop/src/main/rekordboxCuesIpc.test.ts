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
    registerRekordboxCuesIpc({ collection: () => '/c/master.db', queue: { enqueue }, applyQuietly })
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

  it('reads nothing without a collection', () => {
    registerRekordboxCuesIpc({
      collection: () => '',
      queue: { enqueue: vi.fn() },
      applyQuietly: vi.fn(),
    })
    expect(handler('rekordbox:trackCues')({}, '103')).toBeNull()
  })
})
