import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { registerMatchingIpc } from './matchingIpc'
import { createMatchingStore } from './matchingStore'

function handler(channel: string): (...args: unknown[]) => unknown {
  const call = [...vi.mocked(ipcMain.handle).mock.calls].reverse().find(([n]) => n === channel)
  if (!call) throw new Error(`${channel} not registered`)
  return call[1] as (...args: unknown[]) => unknown
}

describe('registerMatchingIpc', () => {
  it('adds, lists and removes Surco pairs for the renderer', async () => {
    const store = createMatchingStore(join(await mkdtemp(join(tmpdir(), 'surco-mipc-')), 'm.json'))
    registerMatchingIpc(store)
    await handler('matching:add')({}, '/m/a.wav', '/m/b.wav')
    expect(await handler('matching:list')({})).toEqual([['/m/a.wav', '/m/b.wav']])
    await handler('matching:remove')({}, '/m/b.wav', '/m/a.wav')
    expect(await handler('matching:list')({})).toEqual([])
  })

  it('removes many Surco pairs at once, leaving out whatever does not name two paths', async () => {
    const store = createMatchingStore(join(await mkdtemp(join(tmpdir(), 'surco-mipc-')), 'm.json'))
    registerMatchingIpc(store)
    await handler('matching:add')({}, '/m/a.wav', '/m/b.wav')
    await handler('matching:add')({}, '/m/a.wav', '/m/c.wav')
    await handler('matching:add')({}, '/m/c.wav', '/m/d.wav')
    await handler('matching:removeAll')({}, [
      ['/m/a.wav', '/m/b.wav'],
      ['/m/c.wav', 7],
      'x',
      ['/m/d.wav', '/m/c.wav'],
    ])
    expect(await handler('matching:list')({})).toEqual([['/m/a.wav', '/m/c.wav']])
  })

  it('ignores a call that does not name two paths, so a bad message cannot break the file', async () => {
    const store = createMatchingStore(join(await mkdtemp(join(tmpdir(), 'surco-mipc-')), 'm.json'))
    registerMatchingIpc(store)
    await handler('matching:add')({}, '/m/a.wav', 7)
    expect(await handler('matching:list')({})).toEqual([])
  })
})
