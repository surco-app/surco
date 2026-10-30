import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => 'window') },
}))

import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import { appliedNotice } from './rekordboxQueueIpc'
import { registerTraktorCueQueueIpc } from './traktorCueQueueIpc'

function handler(channel: string): (...args: unknown[]) => unknown {
  const call = [...vi.mocked(ipcMain.handle).mock.calls].reverse().find(([n]) => n === channel)
  if (!call) throw new Error(`${channel} not registered`)
  return call[1] as (...args: unknown[]) => unknown
}

const APPLIED: QueueApply = {
  status: 'applied',
  tracks: 1,
  changes: 0,
  notices: [{ code: 'cues-calls-dropped', track: 'Tengo', calls: [4000] }],
  written: [],
  outcomes: [{ id: 'c', applied: true, notices: [] }],
}

function queue(result: QueueApply = APPLIED) {
  return {
    state: vi.fn(() => ({ tracks: 1, changes: 0, items: [] })),
    discard: vi.fn(),
    apply: vi.fn<RekordboxQueue['apply']>(async (ensureClosed) => {
      await ensureClosed()
      return result
    }),
  }
}

describe('registerTraktorCueQueueIpc', () => {
  it('shows what waits for Traktor to close', () => {
    registerTraktorCueQueueIpc(queue(), { ensureClosed: vi.fn(async () => true) })
    expect(handler('traktor:cueQueue')()).toEqual({ tracks: 1, changes: 0, items: [] })
  })

  it('applies now behind the dialog that closes Traktor and answers with what landed', async () => {
    const q = queue()
    const ensureClosed = vi.fn(async () => true)
    registerTraktorCueQueueIpc(q, { ensureClosed })
    expect(await handler('traktor:applyCueQueue')({ sender: {} })).toEqual(appliedNotice(APPLIED))
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
    registerTraktorCueQueueIpc(q, {
      ensureClosed: vi.fn(async () => true),
      beginMoment: (r) => order.push(`begin:${r}`),
    })
    await handler('traktor:applyCueQueue')({ sender: {} })
    expect(order).toEqual(['begin:queue', 'apply'])
  })

  it('keeps watching when the DJ leaves Traktor open, so the save lands once it closes', async () => {
    const onWaiting = vi.fn()
    registerTraktorCueQueueIpc(queue({ status: 'refused', reason: 'cancelled' }), {
      ensureClosed: vi.fn(async () => false),
      onWaiting,
    })
    expect(await handler('traktor:applyCueQueue')({ sender: {} })).toBeNull()
    expect(onWaiting).toHaveBeenCalled()
  })

  it('throws away what waits when the DJ discards it', () => {
    const q = queue()
    registerTraktorCueQueueIpc(q, { ensureClosed: vi.fn(async () => true) })
    handler('traktor:discardCueQueue')()
    expect(q.discard).toHaveBeenCalled()
  })

  it('starts the queue only once the window listens', () => {
    const onReady = vi.fn()
    registerTraktorCueQueueIpc(queue(), { ensureClosed: vi.fn(async () => true), onReady })
    handler('traktor:cueQueueReady')()
    expect(onReady).toHaveBeenCalled()
  })

  // The tracks a conversion left pending on this queue are checked once it applies by hand,
  // and an apply that throws or a discarded queue never leaves them pending.
  it('tells the verification how an apply by hand went', async () => {
    const onSettled = vi.fn()
    registerTraktorCueQueueIpc(queue(), { ensureClosed: vi.fn(async () => true), onSettled })
    await handler('traktor:applyCueQueue')({ sender: {} })
    expect(onSettled).toHaveBeenCalledWith(APPLIED)
  })

  it('tells the verification an apply by hand threw', async () => {
    const onSettled = vi.fn()
    const q = queue()
    q.apply.mockRejectedValueOnce(new Error('disk gone'))
    registerTraktorCueQueueIpc(q, { ensureClosed: vi.fn(async () => true), onSettled })
    await expect(handler('traktor:applyCueQueue')({ sender: {} })).rejects.toThrow('disk gone')
    expect(onSettled).toHaveBeenCalledWith('threw')
  })

  it('tells the verification the queue was discarded', async () => {
    const onDiscarded = vi.fn()
    const q = queue()
    registerTraktorCueQueueIpc(q, { ensureClosed: vi.fn(async () => true), onDiscarded })
    await handler('traktor:discardCueQueue')()
    expect(q.discard).toHaveBeenCalled()
    expect(onDiscarded).toHaveBeenCalled()
  })
})
