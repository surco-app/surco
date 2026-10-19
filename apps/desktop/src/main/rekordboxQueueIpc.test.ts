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
    state: vi.fn(() => ({ tracks: 1, changes: 0, items: [] })),
    isEmpty: vi.fn(() => false),
    discard: vi.fn(),
    drop: vi.fn(),
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

  it('answers no membership without a collection', () => {
    registerRekordboxQueueIpc(queue(), {
      collection: () => '',
      ensureClosed: vi.fn(async () => true),
    })
    expect(handler('rekordbox:membership')({}, ['/m/a.wav'])).toEqual({})
  })
})
