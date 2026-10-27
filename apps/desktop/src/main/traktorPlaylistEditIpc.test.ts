import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => 'window') },
}))

import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import type { EditOp, QueueOp } from './rekordboxQueueOps'
import { registerTraktorPlaylistEditIpc } from './traktorPlaylistEditIpc'
import { PLAYLISTS_SAMPLE } from './traktorPlaylistFixture'
import { traktorStamps, traktorSubtreeStamps } from './traktorPlaylistModel'

function handler(channel: string): (...args: unknown[]) => unknown {
  const call = [...vi.mocked(ipcMain.handle).mock.calls].reverse().find(([n]) => n === channel)
  if (!call) throw new Error(`${channel} not registered`)
  return call[1] as (...args: unknown[]) => unknown
}

async function collection(text = PLAYLISTS_SAMPLE): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), 'surco-traktoredit-')), 'collection.nml')
  await writeFile(file, text)
  return file
}

function setup(path: string, result: (op: QueueOp) => QueueApply) {
  const queued: QueueOp[] = []
  const queue = {
    enqueue: vi.fn<RekordboxQueue['enqueue']>((ops) => {
      queued.push(...ops)
      return true
    }),
    apply: vi.fn<RekordboxQueue['apply']>(async (ensureClosed) => {
      await ensureClosed()
      return result(queued[queued.length - 1])
    }),
    drop: vi.fn<RekordboxQueue['drop']>(),
  }
  const host = {
    collection: () => path,
    queue,
    ensureClosed: vi.fn(async () => true),
    onApplied: vi.fn(),
    onWaiting: vi.fn(),
  }
  registerTraktorPlaylistEditIpc(host)
  return { host, queued }
}

const applied = (op: QueueOp): QueueApply => ({
  status: 'applied',
  tracks: 0,
  changes: 1,
  notices: [],
  written: [],
  outcomes: [{ id: op.id, applied: true, notices: [] }],
})

describe('registerTraktorPlaylistEditIpc', () => {
  it('queues the edit with the stamp of the playlist it names, so a change made in Traktor meanwhile is caught', async () => {
    const file = await collection()
    const { host, queued } = setup(file, applied)
    const edit = { kind: 'remove', playlistId: 'fri', linkIds: ['fri:0:HD/:m/:a.mp3'] }
    expect(await handler('traktor:edit')({ sender: {} }, edit, 'Friday')).toEqual({ applied: true })
    expect((queued[0] as EditOp).stamps).toEqual({ fri: traktorStamps(PLAYLISTS_SAMPLE).fri })
    expect(host.ensureClosed).toHaveBeenCalledWith('window')
  })

  // The delete takes everything below the folder, so a change anywhere in it must catch it.
  it('stamps a folder delete with every node it would take', async () => {
    const file = await collection()
    const { queued } = setup(file, applied)
    await handler('traktor:edit')({ sender: {} }, { kind: 'delete', playlistId: 'folder:Sets#2' })
    const stamps = (queued[0] as EditOp).stamps
    expect(Object.keys(stamps).sort()).toEqual(['folder:Sets#2', 'folder:Sets#2/Old'])
    expect(stamps).toEqual(traktorSubtreeStamps(PLAYLISTS_SAMPLE, 'folder:Sets#2'))
  })

  it('keeps an edit waiting while Traktor stays open and wakes the watcher', async () => {
    const file = await collection()
    const { host } = setup(file, () => ({ status: 'refused', reason: 'cancelled' }))
    const edit = { kind: 'rename', playlistId: 'dnb', name: 'DnB' }
    expect(await handler('traktor:edit')({ sender: {} }, edit)).toEqual({
      applied: false,
      reason: 'cancelled',
    })
    expect(host.onWaiting).toHaveBeenCalled()
    expect(host.queue.drop).not.toHaveBeenCalled()
  })

  it('takes a refused edit out of the queue, so it is never written later', async () => {
    const file = await collection()
    const { host, queued } = setup(file, () => ({ status: 'refused', reason: 'write-failed' }))
    await handler('traktor:edit')({ sender: {} }, { kind: 'delete', playlistId: 'dnb' })
    expect(host.queue.drop).toHaveBeenCalledWith(queued[0].id)
  })

  it('edits nothing without a confirmed collection', async () => {
    const { host } = setup('', applied)
    expect(
      await handler('traktor:edit')({ sender: {} }, { kind: 'delete', playlistId: 'dnb' }),
    ).toEqual({ applied: false, reason: 'unreadable' })
    expect(host.queue.enqueue).not.toHaveBeenCalled()
  })

  it('says whether the collection has a separator the DJ uses', async () => {
    const withSeparator = PLAYLISTS_SAMPLE.replace(
      '<COLLECTION ENTRIES="0"></COLLECTION>',
      '<COLLECTION ENTRIES="1"><ENTRY TITLE=""><LOCATION DIR="/:m/:" FILE="sep.mp3" VOLUME="HD" VOLUMEID="v"></LOCATION><INFO PLAYTIME="1"></INFO></ENTRY></COLLECTION>',
    )
    setup(await collection(withSeparator), applied)
    expect(await handler('traktor:hasSeparator')()).toBe(true)
    setup(await collection(), applied)
    expect(await handler('traktor:hasSeparator')()).toBe(false)
  })
})
