import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => 'window') },
}))

import type { DjCueQueueMain } from '../shared/djApi'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import { appliedNotice, rekordboxQueueSection } from './rekordboxQueueIpc'

let section: DjCueQueueMain

function register(...args: Parameters<typeof rekordboxQueueSection>): void {
  section = rekordboxQueueSection(...args)
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
    holdsRepoint: vi.fn(),
    queuedRepoints: vi.fn(() => []),
    queuedOps: vi.fn(() => []),
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
      created: [{ opId: 'e', createdId: '77' }],
    })
  })

  it('names the playlists a queued create made, so the session waiting on one can open it', () => {
    const notice = appliedNotice({
      ...APPLIED,
      outcomes: [
        { id: 'op1', applied: true, createdId: '9001', notices: [] },
        { id: 'op2', applied: true, notices: [] },
        { id: 'op3', applied: false, reason: 'stale', notices: [] },
      ],
    } as QueueApply)
    expect(notice).toMatchObject({ created: [{ opId: 'op1', createdId: '9001' }] })
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

describe('rekordboxQueueSection', () => {
  it('applies now behind the close dialog and answers with the notice', async () => {
    const q = queue()
    const ensureClosed = vi.fn(async () => true)
    register(q, { ensureClosed })
    expect(await section.apply({} as WebContents)).toEqual(appliedNotice(APPLIED))
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
    register(q, {
      ensureClosed: vi.fn(async () => true),
      beginMoment: (r) => order.push(`begin:${r}`),
    })
    await section.apply({} as WebContents)
    expect(order).toEqual(['begin:queue', 'apply'])
  })

  it('starts the queue only once the window listens, so the startup apply is never announced to nobody', async () => {
    const onReady = vi.fn()
    register(queue(), {
      ensureClosed: vi.fn(async () => true),
      onReady,
    })
    expect(onReady).not.toHaveBeenCalled()
    await section.ready()
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('wakes the watcher when the apply is cancelled and the work keeps waiting', async () => {
    const onWaiting = vi.fn()
    register(queue({ status: 'refused', reason: 'cancelled' }), {
      ensureClosed: vi.fn(async () => false),
      onWaiting,
    })
    expect(await section.apply({} as WebContents)).toBeNull()
    expect(onWaiting).toHaveBeenCalledTimes(1)
  })

  it('does not wake the watcher after a refusal that retrying would only repeat', async () => {
    const onWaiting = vi.fn()
    register(queue({ status: 'refused', reason: 'backup-failed' }), {
      ensureClosed: vi.fn(async () => true),
      onWaiting,
    })
    await section.apply({} as WebContents)
    expect(onWaiting).not.toHaveBeenCalled()
  })

  it('discards and reports the state', async () => {
    const q = queue()
    register(q, {
      ensureClosed: vi.fn(async () => true),
    })
    await section.discard()
    expect(q.discard).toHaveBeenCalled()
    expect(section.read()).toEqual({ tracks: 1, changes: 0, items: [] })
  })

  // The tracks a conversion left pending on this queue are checked once it applies by hand,
  // and an apply that throws or a discarded queue never leaves them pending.
  it('tells the verification how an apply by hand went', async () => {
    const onSettled = vi.fn()
    register(queue(), {
      ensureClosed: vi.fn(async () => true),
      onSettled,
    })
    await section.apply({} as WebContents)
    expect(onSettled).toHaveBeenCalledWith(APPLIED)
  })

  it('tells the verification an apply by hand threw', async () => {
    const onSettled = vi.fn()
    const q = queue()
    q.apply.mockRejectedValueOnce(new Error('disk gone'))
    register(q, {
      ensureClosed: vi.fn(async () => true),
      onSettled,
    })
    await expect(section.apply({} as WebContents)).rejects.toThrow('disk gone')
    expect(onSettled).toHaveBeenCalledWith('threw')
  })

  it('tells the verification the queue was discarded', async () => {
    const onDiscarded = vi.fn()
    const q = queue()
    register(q, {
      ensureClosed: vi.fn(async () => true),
      onDiscarded,
    })
    await section.discard()
    expect(q.discard).toHaveBeenCalled()
    expect(onDiscarded).toHaveBeenCalled()
  })
})
