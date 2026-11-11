import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./seratoCuesWrite', () => ({ applySeratoCuesBatch: vi.fn() }))

import type { DjEditMain } from '../shared/djApi'
import type { RekordboxPlaylistEdit } from '../shared/types'
import { queueWithApplyInFlight } from './editRaceFixture'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import type { EditOp, QueueOp } from './rekordboxQueueOps'
import { seratoEditFiles } from './seratoCrateEdits'
import { create, rename, twoRoots } from './seratoLibraryFixture'
import { seratoEdit } from './seratoPlaylistEditIpc'

let section: DjEditMain

const appliedWith =
  (extra: Partial<QueueApply & { status: 'applied' }> = {}) =>
  (op: QueueOp, closed: boolean): QueueApply =>
    closed
      ? {
          status: 'applied',
          tracks: 0,
          changes: 1,
          notices: [],
          written: [],
          outcomes: [{ id: op.id, applied: true, notices: [], createdId: 'New' }],
          ...extra,
        }
      : { status: 'refused', reason: 'cancelled' }

function registerWith({
  running,
  crates = ['A', 'House'],
  result = appliedWith(),
}: {
  running: boolean
  crates?: string[]
  result?: (op: QueueOp, closed: boolean) => QueueApply
}) {
  const { roots } = twoRoots({ internal: crates })
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
  section = seratoEdit(host)
  const handle = (edit: RekordboxPlaylistEdit, label?: string) =>
    section.save(edit, label, {} as WebContents)
  return { handle, queue, queued, host, roots }
}

describe('seratoEdit', () => {
  it('in queue mode names the waiting edit so its result can be matched once Serato closes', async () => {
    const { queued, host } = registerWith({ running: true })
    const answer = await section.save(
      create('root', 'Sesion'),
      'Sesion',
      {} as WebContents,
      'queue',
    )
    expect(answer).toEqual({ applied: false, queued: true, opId: queued[0].id })
    expect(host.onWaiting).toHaveBeenCalledOnce()
  })

  it('serato:edit queues the edit and says it waits while Serato is open, without asking to close it', async () => {
    const { handle, queue, host } = registerWith({ running: true })
    expect(await handle(rename('A', 'X'), 'A')).toEqual({
      applied: false,
      reason: 'cancelled',
    })
    expect(queue.enqueue).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'edit', files: expect.any(Object) }),
    ])
    expect(host.onWaiting).toHaveBeenCalled()
    expect(queue.drop).not.toHaveBeenCalled()
  })

  it('stamps the crates the edit touches as they are now, so a change made in Serato meanwhile is caught', async () => {
    const { handle, queued, roots } = registerWith({ running: false })
    await handle(rename('A', 'X'), 'A')
    expect(queued[0]).toMatchObject({
      kind: 'edit',
      edit: rename('A', 'X'),
      label: 'A',
      files: seratoEditFiles(rename('A', 'X'), roots),
    })
  })

  it('applies at once when Serato is closed and hands back the new crate', async () => {
    const { handle, host } = registerWith({ running: false })
    expect(await handle(create('root', 'New'), 'New')).toEqual({
      applied: true,
      createdId: 'New',
    })
    expect(host.onWaiting).not.toHaveBeenCalled()
  })

  it('announces what else the queue wrote alongside the edit', async () => {
    const { handle, host } = registerWith({
      running: false,
      result: (op) => ({
        status: 'applied',
        tracks: 2,
        changes: 3,
        notices: [],
        written: [],
        outcomes: [
          { id: op.id, applied: true, notices: [] },
          { id: 'cues', applied: true, notices: [] },
        ],
      }),
    })
    await handle(rename('A', 'X'))
    expect(host.onApplied).toHaveBeenCalledWith(
      expect.objectContaining({ tracks: 2, changes: 2, outcomes: [expect.anything()] }),
    )
  })

  it('takes a refused edit out of the queue, so it is never written later', async () => {
    const { handle, queue, queued } = registerWith({
      running: false,
      result: () => ({ status: 'refused', reason: 'write-failed' }),
    })
    expect(await handle(rename('A', 'X'))).toEqual({
      applied: false,
      reason: 'write-failed',
    })
    expect(queue.drop).toHaveBeenCalledWith(queued[0].id)
  })

  it('serato:edit refuses a bad name before queueing it', async () => {
    const { handle, queue } = registerWith({ running: false })
    expect(await handle(create('root', 'a%%b'), 'a%%b')).toEqual({
      applied: false,
      reason: 'bad-name',
    })
    expect(await handle(rename('A', 'a/b'), 'A')).toEqual({
      applied: false,
      reason: 'bad-name',
    })
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('refuses a name another crate already has, whatever its case, before queueing it, so the user never reads it as a change made in Serato', async () => {
    const { handle, queue } = registerWith({ running: true })
    expect(await handle(create('root', 'house'), 'house')).toEqual({
      applied: false,
      reason: 'bad-name',
    })
    expect(await handle(rename('A', 'HOUSE'), 'A')).toEqual({
      applied: false,
      reason: 'bad-name',
    })
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('queues a rename that only changes the case of the crate', async () => {
    const { handle, queue } = registerWith({ running: true })
    await handle(rename('House', 'HOUSE'), 'House')
    expect(queue.enqueue).toHaveBeenCalled()
  })
})

describe('seratoEdit with an apply already running', () => {
  it('says the edit was written when that apply wrote it, not that it failed', async () => {
    const { roots } = twoRoots({})
    const race = queueWithApplyInFlight('Nueva')
    const saving = seratoEdit({
      roots: () => roots,
      queue: race.queue,
      isRunning: async () => false,
    }).save(create('root', 'Nueva'), 'Nueva', {} as WebContents)
    await race.release()
    expect(await saving).toEqual({ applied: true, createdId: 'Nueva' })
  })
})
