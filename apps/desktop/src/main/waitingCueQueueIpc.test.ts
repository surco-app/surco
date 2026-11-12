import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: vi.fn(() => 'window') } }))

import type { DjCueQueueMain } from '../shared/djApi'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import { appliedNotice } from './rekordboxQueueIpc'
import { waitingCueQueueSection } from './waitingCueQueueIpc'

let section: DjCueQueueMain

function register(...args: Parameters<typeof waitingCueQueueSection>): void {
  section = waitingCueQueueSection(...args)
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

describe('waitingCueQueueSection', () => {
  it('shows what waits for Serato to close', () => {
    register(queue(), { isRunning: vi.fn(async () => false) })
    expect(section.read()).toEqual({ tracks: 1, changes: 0, items: [] })
  })

  it('writes now when Serato is closed and answers with what landed', async () => {
    const q = queue()
    register(q, { isRunning: vi.fn(async () => false) })
    expect(await section.apply({} as WebContents)).toEqual(appliedNotice(APPLIED))
    expect(q.apply).toHaveBeenCalledWith(expect.any(Function), { manual: true })
  })

  it('never writes while Serato is open, and keeps watching so the save lands once it closes', async () => {
    const onWaiting = vi.fn()
    const isRunning = vi.fn(async () => true)
    register(queue(), { isRunning, onWaiting })
    expect(await section.apply({} as WebContents)).toBeNull()
    expect(isRunning).toHaveBeenCalled()
    expect(onWaiting).toHaveBeenCalled()
  })

  it('throws away what waits when the DJ discards it', () => {
    const q = queue()
    register(q, { isRunning: vi.fn(async () => false) })
    section.discard()
    expect(q.discard).toHaveBeenCalled()
  })

  it('starts the queue only once the window listens', () => {
    const onReady = vi.fn()
    register(queue(), { isRunning: vi.fn(async () => false), onReady })
    section.ready()
    expect(onReady).toHaveBeenCalled()
  })
})
