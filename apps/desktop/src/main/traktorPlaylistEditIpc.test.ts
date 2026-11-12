import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => 'window') },
}))

import type { DjEditMain } from '../shared/djApi'
import type { RekordboxPlaylistEdit } from '../shared/types'
import { queueWithApplyInFlight } from './editRaceFixture'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import type { EditOp, QueueOp } from './rekordboxQueueOps'
import { traktorEdit } from './traktorPlaylistEditIpc'
import { PLAYLISTS_SAMPLE } from './traktorPlaylistFixture'
import { traktorStamps, traktorSubtreeStamps } from './traktorPlaylistModel'

let section: DjEditMain

const save = (edit: RekordboxPlaylistEdit, label?: string) =>
  section.save(edit, label, {} as WebContents)

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
    outcomeOf: vi.fn<RekordboxQueue['outcomeOf']>(),
  }
  const host = {
    collection: () => path,
    queue,
    ensureClosed: vi.fn(async () => true),
    isRunning: vi.fn(async () => false),
    onApplied: vi.fn(),
    onWaiting: vi.fn(),
  }
  section = traktorEdit(host)
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

describe('traktorEdit', () => {
  it('queues the edit with the stamp of the playlist it names, so a change made in Traktor meanwhile is caught', async () => {
    const file = await collection()
    const { host, queued } = setup(file, applied)
    const edit: RekordboxPlaylistEdit = {
      kind: 'remove',
      playlistId: 'fri',
      linkIds: ['fri:0:HD/:m/:a.mp3'],
    }
    expect(await save(edit, 'Friday')).toEqual({ applied: true })
    expect((queued[0] as EditOp).stamps).toEqual({ fri: traktorStamps(PLAYLISTS_SAMPLE).fri })
    expect(host.ensureClosed).toHaveBeenCalledWith('window')
  })

  // The delete takes everything below the folder, so a change anywhere in it must catch it.
  it('stamps a folder delete with every node it would take', async () => {
    const file = await collection()
    const { queued } = setup(file, applied)
    await save({ kind: 'delete', playlistId: 'folder:Sets#2' })
    const stamps = (queued[0] as EditOp).stamps
    expect(Object.keys(stamps).sort()).toEqual(['folder:Sets#2', 'folder:Sets#2/Old'])
    expect(stamps).toEqual(traktorSubtreeStamps(PLAYLISTS_SAMPLE, 'folder:Sets#2'))
  })

  it('a playlist edit is a small change of its collection, marked before the queue applies', async () => {
    const file = await collection()
    const { host } = setup(file, applied)
    const order: string[] = []
    host.queue.apply.mockImplementationOnce(async () => {
      order.push('apply')
      return applied({ id: 'x' } as QueueOp)
    })
    section = traktorEdit({ ...host, beginLoose: (p) => order.push(`loose:${p}`) })
    await save({ kind: 'delete', playlistId: 'dnb' })
    expect(order).toEqual([`loose:${file}`, 'apply'])
  })

  it('in queue mode leaves the edit waiting for Traktor to close without asking, and names it so its result can be matched later', async () => {
    const file = await collection()
    const { host, queued } = setup(file, () => ({ status: 'refused', reason: 'cancelled' }))
    host.isRunning.mockResolvedValue(true)
    const edit: RekordboxPlaylistEdit = {
      kind: 'create',
      parentId: 'root',
      name: 'Sesion',
      folder: false,
      tracks: [],
    }
    const answer = await section.save(edit, 'Sesion', {} as WebContents, 'queue')
    expect(answer).toEqual({ applied: false, queued: true, opId: queued[0].id })
    expect(host.ensureClosed).not.toHaveBeenCalled()
    expect(host.onWaiting).toHaveBeenCalledOnce()
  })

  it('keeps an edit waiting while Traktor stays open and wakes the watcher', async () => {
    const file = await collection()
    const { host } = setup(file, () => ({ status: 'refused', reason: 'cancelled' }))
    const edit: RekordboxPlaylistEdit = { kind: 'rename', playlistId: 'dnb', name: 'DnB' }
    expect(await save(edit)).toEqual({
      applied: false,
      reason: 'cancelled',
    })
    expect(host.onWaiting).toHaveBeenCalled()
    expect(host.queue.drop).not.toHaveBeenCalled()
  })

  it('takes a refused edit out of the queue, so it is never written later', async () => {
    const file = await collection()
    const { host, queued } = setup(file, () => ({ status: 'refused', reason: 'write-failed' }))
    await save({ kind: 'delete', playlistId: 'dnb' })
    expect(host.queue.drop).toHaveBeenCalledWith(queued[0].id)
  })

  it('edits nothing without a confirmed collection', async () => {
    const { host } = setup('', applied)
    expect(await save({ kind: 'delete', playlistId: 'dnb' })).toEqual({
      applied: false,
      reason: 'unreadable',
    })
    expect(host.queue.enqueue).not.toHaveBeenCalled()
  })

  it('says whether the collection has a separator the DJ uses', async () => {
    const withSeparator = PLAYLISTS_SAMPLE.replace(
      '<COLLECTION ENTRIES="0"></COLLECTION>',
      '<COLLECTION ENTRIES="1"><ENTRY TITLE=""><LOCATION DIR="/:m/:" FILE="sep.mp3" VOLUME="HD" VOLUMEID="v"></LOCATION><INFO PLAYTIME="1"></INFO></ENTRY></COLLECTION>',
    )
    setup(await collection(withSeparator), applied)
    expect(await section.hasSeparator?.()).toBe(true)
    setup(await collection(), applied)
    expect(await section.hasSeparator?.()).toBe(false)
  })
})

describe('traktorEdit with an apply already running', () => {
  it('says the edit was written when that apply wrote it, not that it failed', async () => {
    const race = queueWithApplyInFlight('Nueva')
    const saving = traktorEdit({
      collection: () => '/library/collection.nml',
      queue: race.queue,
      ensureClosed: async () => true,
      isRunning: async () => false,
    }).save(
      { kind: 'create', parentId: 'root', name: 'Nueva', folder: false },
      'Nueva',
      {} as WebContents,
    )
    await race.release()
    expect(await saving).toEqual({ applied: true, createdId: 'Nueva' })
  })
})
