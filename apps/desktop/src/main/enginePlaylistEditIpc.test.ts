import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

import type { RekordboxPlaylistEdit } from '../shared/types'
import { queueWithApplyInFlight } from './editRaceFixture'
import { engineEdit } from './enginePlaylistEditIpc'
import { engineDatabasePath } from './enginePlaylists'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import type { EditOp, QueueOp } from './rekordboxQueueOps'

const created = (op: QueueOp, closed: boolean): QueueApply =>
  closed
    ? {
        status: 'applied',
        tracks: 0,
        changes: 1,
        notices: [],
        written: [],
        outcomes: [{ id: op.id, applied: true, notices: [], createdId: '7' }],
      }
    : { status: 'refused', reason: 'cancelled' }

function registerWith({
  running = false,
  libraryDir = '/Engine Library',
  result = created,
}: {
  running?: boolean
  libraryDir?: string
  result?: (op: QueueOp, closed: boolean) => QueueApply
}) {
  const queued: QueueOp[] = []
  const queue = {
    enqueue: vi.fn((ops: EditOp[]) => {
      queued.push(...ops)
    }),
    apply: vi.fn<RekordboxQueue['apply']>(async (ensureClosed) =>
      result(queued[queued.length - 1], await ensureClosed()),
    ),
    drop: vi.fn<RekordboxQueue['drop']>(),
    outcomeOf: vi.fn<RekordboxQueue['outcomeOf']>(),
  }
  const host = {
    libraryDir: () => libraryDir,
    queue,
    isRunning: vi.fn(async () => running),
    onApplied: vi.fn(),
    onWaiting: vi.fn(),
    beginLoose: vi.fn(),
  }
  const edit = engineEdit(host)
  const handle = (e: RekordboxPlaylistEdit, label?: string) =>
    edit.save(e, label, 'sender' as unknown as WebContents)
  return { handle, queue, queued, host }
}

const CREATE: RekordboxPlaylistEdit = {
  kind: 'create',
  parentId: 'root',
  name: 'Session',
  folder: false,
}

describe('engineEdit', () => {
  it('reports a queued edit as waiting, never as refused, and names the waiting op so its result can be matched later', async () => {
    const { handle, queue, queued, host } = registerWith({ running: true })
    const answer = await handle(CREATE, 'Session')
    expect(answer).toEqual({ applied: false, queued: true, opId: queued[0].id })
    expect(host.onWaiting).toHaveBeenCalled()
    expect(queue.drop).not.toHaveBeenCalled()
  })

  it('writes at once when Engine DJ is closed and hands back the new playlist', async () => {
    const { handle } = registerWith({ running: false })
    expect(await handle(CREATE, 'Session')).toEqual({ applied: true, createdId: '7' })
  })

  it('takes a refused edit out of the queue, so it is never written later', async () => {
    const { handle, queue, queued } = registerWith({
      result: () => ({ status: 'refused', reason: 'write-failed' }),
    })
    expect(await handle(CREATE, 'Session')).toEqual({
      applied: false,
      reason: 'write-failed',
    })
    expect(queue.drop).toHaveBeenCalledWith(queued[0].id)
  })

  it('queues the edit with its label and opens the backup moment for the Engine database', async () => {
    const { handle, queued, host } = registerWith({})
    await handle(CREATE, 'Session')
    expect(queued[0]).toMatchObject({ kind: 'edit', edit: CREATE, label: 'Session', stamps: {} })
    expect(host.beginLoose).toHaveBeenCalledWith(engineDatabasePath('/Engine Library'))
  })

  it('refuses without queueing anything when no Engine library is set', async () => {
    const { handle, queue } = registerWith({ libraryDir: '' })
    expect(await handle(CREATE, 'Session')).toEqual({
      applied: false,
      reason: 'unreadable',
    })
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('announces what else the queue wrote alongside the edit', async () => {
    const { handle, host } = registerWith({
      result: (op) => ({
        status: 'applied',
        tracks: 2,
        changes: 1,
        notices: [],
        written: [],
        outcomes: [
          { id: op.id, applied: true, notices: [] },
          { id: 'cues', applied: true, notices: [] },
        ],
      }),
    })
    await handle({ kind: 'delete', playlistId: '5' }, 'House')
    expect(host.onApplied).toHaveBeenCalledWith(
      expect.objectContaining({ tracks: 2, outcomes: [expect.objectContaining({ id: 'cues' })] }),
    )
  })
})

describe('engineEdit with an apply already running', () => {
  it('says the edit was written when that apply wrote it, not that it failed', async () => {
    const race = queueWithApplyInFlight('Nueva')
    const saving = engineEdit({
      libraryDir: () => '/library/Engine Library',
      queue: race.queue,
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
