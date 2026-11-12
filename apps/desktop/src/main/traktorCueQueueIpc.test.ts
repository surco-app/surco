import { describe, expect, it, vi } from 'vitest'

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
    register(queue(), { isClosed: vi.fn(async () => true) })
    expect(section.read()).toEqual({ tracks: 1, changes: 0, items: [] })
  })

  it('applies now without asking the DJ anything, and answers with what landed', async () => {
    const q = queue()
    const isClosed = vi.fn(async () => true)
    register(q, { isClosed })
    expect(await section.apply()).toEqual(appliedNotice(APPLIED))
    expect(isClosed).toHaveBeenCalledWith()
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
      isClosed: vi.fn(async () => true),
      beginMoment: (r) => order.push(`begin:${r}`),
    })
    await section.apply()
    expect(order).toEqual(['begin:queue', 'apply'])
  })

  it('keeps watching when the DJ leaves Traktor open, so the save lands once it closes', async () => {
    const onWaiting = vi.fn()
    register(queue({ status: 'refused', reason: 'cancelled' }), {
      isClosed: vi.fn(async () => false),
      onWaiting,
    })
    expect(await section.apply()).toBeNull()
    expect(onWaiting).toHaveBeenCalled()
  })

  it('throws away what waits when the DJ discards it', () => {
    const q = queue()
    register(q, { isClosed: vi.fn(async () => true) })
    section.discard()
    expect(q.discard).toHaveBeenCalled()
  })

  it('starts the queue only once the window listens', () => {
    const onReady = vi.fn()
    register(queue(), { isClosed: vi.fn(async () => true), onReady })
    section.ready()
    expect(onReady).toHaveBeenCalled()
  })

  // The tracks a conversion left pending on this queue are checked once it applies by hand,
  // and an apply that throws or a discarded queue never leaves them pending.
  it('tells the verification how an apply by hand went', async () => {
    const onSettled = vi.fn()
    register(queue(), { isClosed: vi.fn(async () => true), onSettled })
    await section.apply()
    expect(onSettled).toHaveBeenCalledWith(APPLIED)
  })

  it('tells the verification an apply by hand threw', async () => {
    const onSettled = vi.fn()
    const q = queue()
    q.apply.mockRejectedValueOnce(new Error('disk gone'))
    register(q, { isClosed: vi.fn(async () => true), onSettled })
    await expect(section.apply()).rejects.toThrow('disk gone')
    expect(onSettled).toHaveBeenCalledWith('threw')
  })

  it('tells the verification the queue was discarded', async () => {
    const onDiscarded = vi.fn()
    const q = queue()
    register(q, { isClosed: vi.fn(async () => true), onDiscarded })
    await section.discard()
    expect(q.discard).toHaveBeenCalled()
    expect(onDiscarded).toHaveBeenCalled()
  })
})
