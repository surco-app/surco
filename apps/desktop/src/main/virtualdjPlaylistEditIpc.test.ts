import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { RekordboxPlaylistEdit } from '../shared/types'
import { queueWithApplyInFlight } from './editRaceFixture'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import type { EditOp, QueueOp } from './rekordboxQueueOps'
import { virtualdjEditFiles } from './virtualdjListsWrite'
import { virtualdjEdit } from './virtualdjPlaylistEditIpc'

const appliedWith =
  (createdId?: string) =>
  (op: QueueOp, closed: boolean): QueueApply =>
    closed
      ? {
          status: 'applied',
          tracks: 0,
          changes: 1,
          notices: [],
          written: [],
          outcomes: [{ id: op.id, applied: true, notices: [], ...(createdId && { createdId }) }],
        }
      : { status: 'refused', reason: 'cancelled' }

function registerWith({
  running,
  result = appliedWith('Nueva'),
}: {
  running: boolean
  result?: (op: QueueOp, closed: boolean) => QueueApply
}) {
  const dir = join(mkdtempSync(join(tmpdir(), 'surco-vdj-edit-ipc-')), 'VirtualDJ')
  cpSync(join(__dirname, 'virtualdjFixtures'), dir, { recursive: true })
  const roots = [{ dir, root: '/' }]
  const queued: QueueOp[] = []
  const queue = {
    enqueue: vi.fn((ops: EditOp[]) => {
      queued.push(...ops)
    }),
    apply: vi.fn<RekordboxQueue['apply']>(async (ensureClosed) =>
      result(queued[queued.length - 1], await ensureClosed()),
    ),
    drop: vi.fn<RekordboxQueue['drop']>(),
    settled: vi.fn<RekordboxQueue['settled']>(async () => {}),
  }
  const host = {
    roots: () => roots,
    queue,
    isRunning: vi.fn(async () => running),
    onApplied: vi.fn(),
    onWaiting: vi.fn(),
  }
  const section = virtualdjEdit(host)
  const handle = (edit: RekordboxPlaylistEdit, label?: string, mode?: 'queue') =>
    section.save(edit, label, {} as WebContents, mode)
  return { handle, queue, queued, host, roots }
}

const create = (name: string): RekordboxPlaylistEdit => ({
  kind: 'create',
  parentId: 'root',
  name,
  folder: false,
})

describe('virtualdjEdit', () => {
  it('queues the edit while VirtualDJ is open and says it waits, without asking to close it', async () => {
    const { handle, queue, host } = registerWith({ running: true })
    expect(await handle({ kind: 'rename', playlistId: 'Carpeta', name: 'X' }, 'Carpeta')).toEqual({
      applied: false,
      reason: 'cancelled',
    })
    expect(queue.enqueue).toHaveBeenCalledWith([expect.objectContaining({ kind: 'edit' })])
    expect(host.onWaiting).toHaveBeenCalled()
    expect(queue.drop).not.toHaveBeenCalled()
  })

  it('in queue mode names the waiting edit so a pasted tracklist can follow it once VirtualDJ closes', async () => {
    const { handle, queued } = registerWith({ running: true })
    expect(await handle(create('Sesion'), 'Sesion', 'queue')).toEqual({
      applied: false,
      queued: true,
      opId: queued[0].id,
    })
  })

  it('stamps the list a row edit touches as it is now, so a change made in VirtualDJ meanwhile is caught', async () => {
    const { handle, queued, roots } = registerWith({ running: false })
    const edit: RekordboxPlaylistEdit = {
      kind: 'remove',
      playlistId: 'Surco prueba',
      linkIds: ['0:x'],
    }
    await handle(edit, 'Surco prueba')
    expect(queued[0]).toMatchObject({ edit, files: virtualdjEditFiles(edit, roots) })
    expect(Object.values(virtualdjEditFiles(edit, roots))).toEqual([
      { tracks: expect.arrayContaining(['/Music/Serato Pruebas/Pray.mp3']) },
    ])
  })

  it('applies at once when VirtualDJ is closed and hands back the new list', async () => {
    const { handle, host } = registerWith({ running: false })
    expect(await handle(create('Nueva'), 'Nueva')).toEqual({ applied: true, createdId: 'Nueva' })
    expect(host.onWaiting).not.toHaveBeenCalled()
  })

  it('refuses a name a Mac file name cannot carry before queueing it', async () => {
    const { handle, queue } = registerWith({ running: false })
    expect(await handle(create('a:b'))).toEqual({ applied: false, reason: 'bad-name' })
    expect(await handle({ kind: 'rename', playlistId: 'Carpeta', name: 'a/b' })).toEqual({
      applied: false,
      reason: 'bad-name',
    })
    expect(await handle(create('surco prueba'))).toEqual({ applied: false, reason: 'bad-name' })
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('takes a refused edit out of the queue, so it is never written later', async () => {
    const { handle, queue, queued } = registerWith({
      running: false,
      result: () => ({ status: 'refused', reason: 'write-failed' }),
    })
    expect(await handle(create('Nueva'))).toEqual({ applied: false, reason: 'write-failed' })
    expect(queue.drop).toHaveBeenCalledWith(queued[0].id)
  })

  it('says the edit was written when an apply already running wrote it, not that it failed', async () => {
    const { roots } = registerWith({ running: false })
    const race = queueWithApplyInFlight('Nueva')
    const saving = virtualdjEdit({
      roots: () => roots,
      queue: race.queue,
      isRunning: async () => false,
    }).save(create('Nueva'), 'Nueva', {} as WebContents)
    await race.release()
    expect(await saving).toEqual({ applied: true, createdId: 'Nueva' })
  })
})
