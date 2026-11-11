import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => 'window') },
}))

import type { DjCueQueueMain } from '../shared/djApi'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import { appliedNotice } from './rekordboxQueueIpc'
import { traktorCueQueueSection } from './traktorCueQueueIpc'

let section: DjCueQueueMain

function register(...args: Parameters<typeof traktorCueQueueSection>): void {
  section = traktorCueQueueSection(...args)
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

describe('traktorCueQueueSection', () => {
  it('shows what waits for Traktor to close', () => {
    register(queue(), { ensureClosed: vi.fn(async () => true) })
    expect(section.read()).toEqual({ tracks: 1, changes: 0, items: [] })
  })

  it('applies now behind the dialog that closes Traktor and answers with what landed', async () => {
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

  it('keeps watching when the DJ leaves Traktor open, so the save lands once it closes', async () => {
    const onWaiting = vi.fn()
    register(queue({ status: 'refused', reason: 'cancelled' }), {
      ensureClosed: vi.fn(async () => false),
      onWaiting,
    })
    expect(await section.apply({} as WebContents)).toBeNull()
    expect(onWaiting).toHaveBeenCalled()
  })

  it('throws away what waits when the DJ discards it', () => {
    const q = queue()
    register(q, { ensureClosed: vi.fn(async () => true) })
    section.discard()
    expect(q.discard).toHaveBeenCalled()
  })

  it('starts the queue only once the window listens', () => {
    const onReady = vi.fn()
    register(queue(), { ensureClosed: vi.fn(async () => true), onReady })
    section.ready()
    expect(onReady).toHaveBeenCalled()
  })

  // The tracks a conversion left pending on this queue are checked once it applies by hand,
  // and an apply that throws or a discarded queue never leaves them pending.
  it('tells the verification how an apply by hand went', async () => {
    const onSettled = vi.fn()
    register(queue(), { ensureClosed: vi.fn(async () => true), onSettled })
    await section.apply({} as WebContents)
    expect(onSettled).toHaveBeenCalledWith(APPLIED)
  })

  it('tells the verification an apply by hand threw', async () => {
    const onSettled = vi.fn()
    const q = queue()
    q.apply.mockRejectedValueOnce(new Error('disk gone'))
    register(q, { ensureClosed: vi.fn(async () => true), onSettled })
    await expect(section.apply({} as WebContents)).rejects.toThrow('disk gone')
    expect(onSettled).toHaveBeenCalledWith('threw')
  })

  it('tells the verification the queue was discarded', async () => {
    const onDiscarded = vi.fn()
    const q = queue()
    register(q, { ensureClosed: vi.fn(async () => true), onDiscarded })
    await section.discard()
    expect(q.discard).toHaveBeenCalled()
    expect(onDiscarded).toHaveBeenCalled()
  })
})
