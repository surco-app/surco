import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

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

describe('listreview:removeDuplicates', () => {
  const removal = (from: string, to: string, music?: unknown) => ({
    from,
    to,
    ...(music ? { music } : {}),
  })
  const musicRef = {
    removePid: 'OLD',
    label: 'A - T',
    keep: { persistentId: 'K', label: 'A - T' },
  }
  function register(over: Record<string, unknown> = {}) {
    const d = {
      replace: {
        libraries: {},
        usedByLibrary: vi.fn().mockResolvedValue(false),
        serial: (task: () => Promise<unknown>) => task(),
        warn: vi.fn(),
      },
      realpath: vi.fn(async (p: string) => p),
      trash: vi.fn().mockResolvedValue(undefined),
      music: {
        transferPlaylists: vi.fn().mockResolvedValue('1\t0'),
        deleteEntry: vi.fn().mockResolvedValue('/m/old.aiff'),
      },
      ...over,
    }
    registerListReviewIpc({
      apply: {} as never,
      isAllowed: (p: string) => p.startsWith('/m/'),
      removal: () => d,
    } as never)
    return d
  }

  it('removes the Music entry and trashes the file of a copy that is really leaving', async () => {
    const d = register()
    const out = await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/old.aiff', '/m/keep.aiff', musicRef),
    ])
    expect(out).toEqual([
      { from: '/m/old.aiff', music: 'removed', fileTrashed: true, keptForLibrary: false },
    ])
    expect(d.music.deleteEntry).toHaveBeenCalledWith('OLD', 'A - T', '/m/old.aiff')
    expect(d.trash).toHaveBeenCalledWith('/m/old.aiff')
  })

  // Two paths to one file: trashing the "copy" would take the kept audio with it.
  it('touches nothing when both paths are the same real file', async () => {
    const d = register({ realpath: vi.fn().mockResolvedValue('/m/real.aiff') })
    const out = await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/a.aiff', '/m/b.aiff', musicRef),
    ])
    expect(out).toEqual([{ from: '/m/a.aiff', fileTrashed: false, keptForLibrary: false }])
    expect(d.music.transferPlaylists).not.toHaveBeenCalled()
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('fails closed when a path cannot be resolved', async () => {
    const d = register({ realpath: vi.fn(async (p: string) => (p === '/m/b.aiff' ? null : p)) })
    await handlerFor('listreview:removeDuplicates')({ sender }, [removal('/m/a.aiff', '/m/b.aiff')])
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('never trashes a path the app never handed to the renderer', async () => {
    const d = register()
    await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/Users/me/doc.pdf', '/m/b.aiff'),
    ])
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('never trusts a kept copy the app never handed to the renderer', async () => {
    const d = register()
    await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/a.aiff', '/Users/me/doc.pdf'),
    ])
    expect(d.trash).not.toHaveBeenCalled()
  })

  // A file Music still holds twice stays, or Music would show a dead entry.
  it('keeps the file Music holds twice', async () => {
    const d = register()
    const out = await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/old.aiff', '/m/keep.aiff', 'ambiguous'),
    ])
    expect(out).toEqual([
      {
        from: '/m/old.aiff',
        music: 'ambiguous',
        fileTrashed: false,
        keptForLibrary: false,
        keptForMusic: true,
      },
    ])
    expect(d.trash).not.toHaveBeenCalled()
  })

  // trashRecoverably throws rather than hard-delete on a volume with no Trash.
  it('reports a file the Trash refused as still on disk', async () => {
    register({ trash: vi.fn().mockRejectedValue(new Error('No recoverable trash')) })
    const out = await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/old.aiff', '/m/keep.aiff', musicRef),
    ])
    expect(out).toEqual([
      {
        from: '/m/old.aiff',
        music: 'removed',
        fileTrashed: false,
        keptForLibrary: false,
        trashFailed: true,
      },
    ])
  })

  it('has no Music step off macOS', async () => {
    const d = register({ music: undefined })
    const out = await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/old.aiff', '/m/keep.aiff', musicRef),
    ])
    expect(out).toEqual([{ from: '/m/old.aiff', fileTrashed: true, keptForLibrary: false }])
    expect(d.trash).toHaveBeenCalled()
  })
})
