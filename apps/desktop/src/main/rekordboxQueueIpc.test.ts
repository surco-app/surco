import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => 'window') },
}))

import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import { appliedNotice, registerRekordboxQueueIpc } from './rekordboxQueueIpc'

function handler(channel: string): (...args: unknown[]) => unknown {
  const call = [...vi.mocked(ipcMain.handle).mock.calls].reverse().find(([n]) => n === channel)
  if (!call) throw new Error(`${channel} not registered`)
  return call[1] as (...args: unknown[]) => unknown
}

const APPLIED: QueueApply = {
  status: 'applied',
  tracks: 3,
  changes: 0,
  notices: [{ code: 'ambiguous', track: 'Ekkah' }],
  written: [{ path: '/m/e.wav', wanted: [{ name: 'Surco prueba A' }] }],
  outcomes: [{ id: 'e', applied: true, createdId: '77', notices: [] }],
}

function queue(result: QueueApply = APPLIED) {
  return {
    enqueue: vi.fn(),
    announce: vi.fn(),
    state: vi.fn(() => ({ tracks: 1, changes: 0, items: [] })),
    isEmpty: vi.fn(() => false),
    discard: vi.fn(),
    discardCurrent: vi.fn(),
    drop: vi.fn(),
    cuesOp: vi.fn(),
    busy: vi.fn(() => false),
    settled: vi.fn(async () => {}),
    apply: vi.fn<RekordboxQueue['apply']>(async (ensureClosed) => {
      await ensureClosed()
      return result
    }),
  }
}

describe('appliedNotice', () => {
  it('tells what was written and what rekordbox kept', () => {
    expect(appliedNotice(APPLIED)).toEqual({
      tracks: 3,
      changes: 0,
      notices: [{ code: 'ambiguous', track: 'Ekkah' }],
      written: [{ path: '/m/e.wav', wanted: [{ name: 'Surco prueba A' }] }],
    })
  })

  it('says nothing when rekordbox is still open or nothing was queued', () => {
    expect(appliedNotice({ status: 'refused', reason: 'cancelled' })).toBeNull()
    expect(appliedNotice({ status: 'refused', reason: 'rekordbox-running' })).toBeNull()
    expect(appliedNotice({ status: 'empty' })).toBeNull()
  })

  it('names a refusal the user has to know about', () => {
    expect(appliedNotice({ status: 'refused', reason: 'backup-failed' })).toEqual({
      refused: 'backup-failed',
    })
  })
})

describe('registerRekordboxQueueIpc', () => {
  it('applies now behind the close dialog and answers with the notice', async () => {
    const q = queue()
    const ensureClosed = vi.fn(async () => true)
    registerRekordboxQueueIpc(q, { collection: () => '/c/master.db', ensureClosed })
    expect(await handler('rekordbox:applyNow')({ sender: {} })).toEqual(appliedNotice(APPLIED))
    expect(ensureClosed).toHaveBeenCalledWith('window')
    expect(q.apply).toHaveBeenCalledWith(expect.any(Function), { manual: true })
  })

  it('applying the queue by hand is a queue momento, begun before the queue applies', async () => {
    const order: string[] = []
    const q = queue()
    const apply = q.apply.getMockImplementation()
    q.apply.mockImplementation(async (...args) => {
      order.push('apply')
      return apply ? apply(...args) : APPLIED
    })
    registerRekordboxQueueIpc(q, {
      collection: () => '/c/master.db',
      ensureClosed: vi.fn(async () => true),
      beginMoment: (r) => order.push(`begin:${r}`),
    })
    await handler('rekordbox:applyNow')({ sender: {} })
    expect(order).toEqual(['begin:queue', 'apply'])
  })

  it('starts the queue only once the window listens, so the startup apply is never announced to nobody', async () => {
    const onReady = vi.fn()
    registerRekordboxQueueIpc(queue(), {
      collection: () => '/c/master.db',
      ensureClosed: vi.fn(async () => true),
      onReady,
    })
    expect(onReady).not.toHaveBeenCalled()
    await handler('rekordbox:queueReady')()
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('wakes the watcher when the apply is cancelled and the work keeps waiting', async () => {
    const onWaiting = vi.fn()
    registerRekordboxQueueIpc(queue({ status: 'refused', reason: 'cancelled' }), {
      collection: () => '/c/master.db',
      ensureClosed: vi.fn(async () => false),
      onWaiting,
    })
    expect(await handler('rekordbox:applyNow')({ sender: {} })).toBeNull()
    expect(onWaiting).toHaveBeenCalledTimes(1)
  })

  it('does not wake the watcher after a refusal that retrying would only repeat', async () => {
    const onWaiting = vi.fn()
    registerRekordboxQueueIpc(queue({ status: 'refused', reason: 'backup-failed' }), {
      collection: () => '/c/master.db',
      ensureClosed: vi.fn(async () => true),
      onWaiting,
    })
    await handler('rekordbox:applyNow')({ sender: {} })
    expect(onWaiting).not.toHaveBeenCalled()
  })

  it('discards and reports the state', async () => {
    const q = queue()
    registerRekordboxQueueIpc(q, {
      collection: () => '',
      ensureClosed: vi.fn(async () => true),
    })
    await handler('rekordbox:discardQueue')()
    expect(q.discard).toHaveBeenCalled()
    expect(handler('rekordbox:queue')()).toEqual({ tracks: 1, changes: 0, items: [] })
  })

  it('answers no membership without a collection', async () => {
    registerRekordboxQueueIpc(queue(), {
      collection: () => '',
      ensureClosed: vi.fn(async () => true),
    })
    expect(await handler('rekordbox:membership')({}, ['/m/a.wav'])).toEqual({})
  })

  // The tracks a conversion left pending on this queue are checked once it applies by hand,
  // and an apply that throws or a discarded queue never leaves them pending.
  it('tells the verification how an apply by hand went', async () => {
    const onSettled = vi.fn()
    registerRekordboxQueueIpc(queue(), {
      collection: () => '',
      ensureClosed: vi.fn(async () => true),
      onSettled,
    })
    await handler('rekordbox:applyNow')({ sender: {} })
    expect(onSettled).toHaveBeenCalledWith(APPLIED)
  })

  it('tells the verification an apply by hand threw', async () => {
    const onSettled = vi.fn()
    const q = queue()
    q.apply.mockRejectedValueOnce(new Error('disk gone'))
    registerRekordboxQueueIpc(q, {
      collection: () => '',
      ensureClosed: vi.fn(async () => true),
      onSettled,
    })
    await expect(handler('rekordbox:applyNow')({ sender: {} })).rejects.toThrow('disk gone')
    expect(onSettled).toHaveBeenCalledWith('threw')
  })

  it('tells the verification the queue was discarded', async () => {
    const onDiscarded = vi.fn()
    const q = queue()
    registerRekordboxQueueIpc(q, {
      collection: () => '',
      ensureClosed: vi.fn(async () => true),
      onDiscarded,
    })
    await handler('rekordbox:discardQueue')()
    expect(q.discard).toHaveBeenCalled()
    expect(onDiscarded).toHaveBeenCalled()
  })
})
