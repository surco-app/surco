import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { ipcMain } from 'electron'
import { registerListReviewIpc } from './listReviewIpc'

function handlerFor(channel: string): (e: unknown, ...args: unknown[]) => unknown {
  const call = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.find(
    ([ch]) => ch === channel,
  )
  if (!call) throw new Error(`no handler registered for ${channel}`)
  return call[1]
}

const sender = { isDestroyed: () => false, send: vi.fn() }

beforeEach(() => vi.clearAllMocks())

describe('registerListReviewIpc', () => {
  it('sends progress to the window that asked and stops when told to', async () => {
    let release = () => {}
    const rewrite = vi.fn(
      () =>
        new Promise<{ outcomes: 'written'[] }>((resolve) => {
          release = () => resolve({ outcomes: ['written'] })
        }),
    )
    registerListReviewIpc({
      apply: { allowed: () => true, exists: async () => true, rewrite },
    } as never)
    const fix = (id: string) => ({ id, field: 'artist', from: 'a', to: 'b' })
    const running = handlerFor('listreview:applyFixes')(
      { sender },
      { fixes: [fix('/a'), fix('/b')], music: {} },
    )
    await vi.waitFor(() => expect(rewrite).toHaveBeenCalledTimes(1))
    await handlerFor('listreview:cancelFixes')({})
    release()
    expect(await running).toHaveLength(1)
    expect(sender.send).toHaveBeenCalledWith('listreview:fixProgress', {
      done: 0,
      total: 2,
      current: 1,
    })
  })

  // A second apply started after a cancel must not wake the first one up again.
  it('keeps a cancelled run stopped when another one starts', async () => {
    const releases: (() => void)[] = []
    const rewrite = vi.fn(() =>
      releases.length < 2
        ? new Promise<{ outcomes: 'written'[] }>((resolve) => {
            releases.push(() => resolve({ outcomes: ['written'] }))
          })
        : Promise.resolve({ outcomes: ['written' as const] }),
    )
    registerListReviewIpc({
      apply: { allowed: () => true, exists: async () => true, rewrite },
    } as never)
    const fix = (id: string) => ({ id, field: 'artist', from: 'a', to: 'b' })
    const first = handlerFor('listreview:applyFixes')(
      { sender },
      { fixes: [fix('/a'), fix('/b')], music: {} },
    )
    await vi.waitFor(() => expect(rewrite).toHaveBeenCalledTimes(1))
    await handlerFor('listreview:cancelFixes')({})
    const second = handlerFor('listreview:applyFixes')(
      { sender },
      { fixes: [fix('/c')], music: {} },
    )
    await vi.waitFor(() => expect(rewrite).toHaveBeenCalledTimes(2))
    for (const release of releases) release()
    expect(await first).toHaveLength(1)
    expect(await second).toHaveLength(1)
  })
})
