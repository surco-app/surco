import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import { appliedNotice } from './rekordboxQueueIpc'
import { registerSeratoCueQueueIpc } from './seratoCueQueueIpc'

function handler(channel: string): (...args: unknown[]) => unknown {
  const call = [...vi.mocked(ipcMain.handle).mock.calls].reverse().find(([n]) => n === channel)
  if (!call) throw new Error(`${channel} not registered`)
  return call[1] as (...args: unknown[]) => unknown
}

const APPLIED: QueueApply = {
  status: 'applied',
  tracks: 1,
  changes: 0,
  notices: [{ code: 'cues-changed', track: 'Pray' }],
  written: [],
  outcomes: [{ id: 'c', applied: false, notices: [{ code: 'cues-changed', track: 'Pray' }] }],
}

function queue() {
  return {
    state: vi.fn(() => ({ tracks: 1, changes: 0, items: [] })),
    discard: vi.fn(),
    apply: vi.fn<RekordboxQueue['apply']>(async (ensureClosed) =>
      (await ensureClosed()) ? APPLIED : { status: 'refused', reason: 'cancelled' },
    ),
  }
}

describe('registerSeratoCueQueueIpc', () => {
  it('shows what waits for Serato to close', () => {
    registerSeratoCueQueueIpc(queue(), { isRunning: vi.fn(async () => false) })
    expect(handler('serato:cueQueue')()).toEqual({ tracks: 1, changes: 0, items: [] })
  })

  it('writes now when Serato is closed and answers with what landed', async () => {
    const q = queue()
    registerSeratoCueQueueIpc(q, { isRunning: vi.fn(async () => false) })
    expect(await handler('serato:applyCueQueue')({ sender: {} })).toEqual(appliedNotice(APPLIED))
    expect(q.apply).toHaveBeenCalledWith(expect.any(Function), { manual: true })
  })

  it('never writes while Serato is open, and keeps watching so the save lands once it closes', async () => {
    const onWaiting = vi.fn()
    const isRunning = vi.fn(async () => true)
    registerSeratoCueQueueIpc(queue(), { isRunning, onWaiting })
    expect(await handler('serato:applyCueQueue')({ sender: {} })).toBeNull()
    expect(isRunning).toHaveBeenCalled()
    expect(onWaiting).toHaveBeenCalled()
  })

  it('throws away what waits when the DJ discards it', () => {
    const q = queue()
    registerSeratoCueQueueIpc(q, { isRunning: vi.fn(async () => false) })
    handler('serato:discardCueQueue')()
    expect(q.discard).toHaveBeenCalled()
  })

  it('starts the queue only once the window listens', () => {
    const onReady = vi.fn()
    registerSeratoCueQueueIpc(queue(), { isRunning: vi.fn(async () => false), onReady })
    handler('serato:cueQueueReady')()
    expect(onReady).toHaveBeenCalled()
  })
})
