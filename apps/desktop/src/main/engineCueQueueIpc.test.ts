import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => 'window') },
}))

import { registerEngineCueQueueIpc } from './engineCueQueueIpc'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import { appliedNotice } from './rekordboxQueueIpc'

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

describe('registerEngineCueQueueIpc', () => {
  it('shows what waits for Engine DJ to close', () => {
    registerEngineCueQueueIpc(queue(), { ensureClosed: vi.fn(async () => true) })
    expect(handler('engine:cueQueue')()).toEqual({ tracks: 1, changes: 0, items: [] })
  })

  it('applies now behind the dialog that closes Engine DJ and answers with what landed', async () => {
    const q = queue()
    const ensureClosed = vi.fn(async () => true)
    registerEngineCueQueueIpc(q, { ensureClosed })
    expect(await handler('engine:applyCueQueue')({ sender: {} })).toEqual(appliedNotice(APPLIED))
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
    registerEngineCueQueueIpc(q, {
      ensureClosed: vi.fn(async () => true),
      beginMoment: (r) => order.push(`begin:${r}`),
    })
    await handler('engine:applyCueQueue')({ sender: {} })
    expect(order).toEqual(['begin:queue', 'apply'])
  })

  it('keeps watching when the DJ leaves Engine DJ open, so the save lands once it closes', async () => {
    const onWaiting = vi.fn()
    registerEngineCueQueueIpc(queue({ status: 'refused', reason: 'cancelled' }), {
      ensureClosed: vi.fn(async () => false),
      onWaiting,
    })
    expect(await handler('engine:applyCueQueue')({ sender: {} })).toBeNull()
    expect(onWaiting).toHaveBeenCalled()
  })

  it('throws away what waits when the DJ discards it', () => {
    const q = queue()
    registerEngineCueQueueIpc(q, { ensureClosed: vi.fn(async () => true) })
    handler('engine:discardCueQueue')()
    expect(q.discard).toHaveBeenCalled()
  })

  it('starts the queue only once the window listens', () => {
    const onReady = vi.fn()
    registerEngineCueQueueIpc(queue(), { ensureClosed: vi.fn(async () => true), onReady })
    handler('engine:cueQueueReady')()
    expect(onReady).toHaveBeenCalled()
  })

  // The tracks a conversion left pending on this queue are checked once it applies by hand,
  // and an apply that throws or a discarded queue never leaves them pending.
  it('tells the verification how an apply by hand went', async () => {
    const onSettled = vi.fn()
    registerEngineCueQueueIpc(queue(), { ensureClosed: vi.fn(async () => true), onSettled })
    await handler('engine:applyCueQueue')({ sender: {} })
    expect(onSettled).toHaveBeenCalledWith(APPLIED)
  })

  it('tells the verification an apply by hand threw', async () => {
    const onSettled = vi.fn()
    const q = queue()
    q.apply.mockRejectedValueOnce(new Error('disk gone'))
    registerEngineCueQueueIpc(q, { ensureClosed: vi.fn(async () => true), onSettled })
    await expect(handler('engine:applyCueQueue')({ sender: {} })).rejects.toThrow('disk gone')
    expect(onSettled).toHaveBeenCalledWith('threw')
  })

  it('tells the verification the queue was discarded', async () => {
    const onDiscarded = vi.fn()
    const q = queue()
    registerEngineCueQueueIpc(q, { ensureClosed: vi.fn(async () => true), onDiscarded })
    await handler('engine:discardCueQueue')()
    expect(q.discard).toHaveBeenCalled()
    expect(onDiscarded).toHaveBeenCalled()
  })
})
