import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import type { ReplacedEntry } from '../shared/toReview'
import { registerReplacedIpc } from './replacedIpc'
import { createReplacedStore } from './replacedStore'

function handler(channel: string): (...args: unknown[]) => unknown {
  const call = [...vi.mocked(ipcMain.handle).mock.calls].reverse().find(([n]) => n === channel)
  if (!call) throw new Error(`${channel} not registered`)
  return call[1] as (...args: unknown[]) => unknown
}

const entry: ReplacedEntry = {
  newPath: '/m/new.flac',
  oldPath: '/m/old.mp3',
  replacedAt: 1,
  shift: { moved: 120 },
  pending: ['rekordbox'],
}

async function setup() {
  const store = createReplacedStore(join(await mkdtemp(join(tmpdir(), 'surco-ripc-')), 'r.json'))
  registerReplacedIpc(store)
  return store
}

describe('registerReplacedIpc', () => {
  it('reviews and restores through the renderer, so Undo reaches the file', async () => {
    const store = await setup()
    store.add(entry)
    expect(await handler('replaced:review')({}, '/m/new.flac')).toEqual(entry)
    expect(await handler('replaced:list')({})).toEqual([])
    await handler('replaced:restore')({}, entry)
    expect(await handler('replaced:list')({})).toEqual([entry])
  })

  it('ignores a review that names no path or names programs that do not exist', async () => {
    const store = await setup()
    store.add(entry)
    expect(await handler('replaced:review')({}, '')).toBeNull()
    expect(await handler('replaced:review')({}, '/m/new.flac', ['bogus'])).toBeNull()
    expect(await handler('replaced:list')({})).toEqual([entry])
  })

  it('ignores a restore whose entry is malformed, so a bad call cannot corrupt the store', async () => {
    await setup()
    await handler('replaced:restore')({}, { newPath: 7 })
    await handler('replaced:restore')({}, null)
    expect(await handler('replaced:list')({})).toEqual([])
  })

  // Undo hands back the entry as it was, earlier paths included, so a moved track keeps
  // closing from the path a queued program still shows; anything else there is refused.
  it('restores a moved track with its earlier paths and refuses earlier paths that are not paths', async () => {
    const store = await setup()
    const moved = { ...entry, formerPaths: ['/m/new.wav'] }
    await handler('replaced:restore')({}, { ...entry, formerPaths: [3] })
    expect(store.list()).toEqual([])
    await handler('replaced:restore')({}, moved)
    expect(store.list()).toEqual([moved])
  })
})
