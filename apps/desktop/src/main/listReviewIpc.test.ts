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
      trash: vi.fn().mockResolvedValue('trash'),
      music: {
        transferPlaylists: vi.fn().mockResolvedValue('1\t0'),
        deleteEntry: vi.fn().mockResolvedValue('/m/old.aiff'),
        filePaths: vi.fn().mockResolvedValue([] as string[]),
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
      {
        from: '/m/old.aiff',
        music: 'removed',
        musicPlaylists: 1,
        fileTrashed: true,
        keptForLibrary: false,
      },
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
    expect(out).toEqual([
      { from: '/m/a.aiff', fileTrashed: false, keptForLibrary: false, keptShared: true },
    ])
    expect(d.music.transferPlaylists).not.toHaveBeenCalled()
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('fails closed when a path cannot be resolved', async () => {
    const d = register({ realpath: vi.fn(async (p: string) => (p === '/m/b.aiff' ? null : p)) })
    await handlerFor('listreview:removeDuplicates')({ sender }, [removal('/m/a.aiff', '/m/b.aiff')])
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('fails closed when the removed copy cannot be resolved', async () => {
    const d = register({ realpath: vi.fn(async (p: string) => (p === '/m/a.aiff' ? null : p)) })
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
        musicPlaylists: 1,
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

  const trashed = (d: { trash: ReturnType<typeof vi.fn> }) => d.trash.mock.calls.map(([p]) => p)

  // The kept copy of one pair is the removed copy of another: trashing it loses the audio.
  it('keeps a removed file that another pair keeps', async () => {
    const d = register()
    const out = (await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/a.aiff', '/m/b.aiff'),
      removal('/m/c.aiff', '/m/a.aiff'),
    ])) as { keptShared?: true }[]
    expect(trashed(d)).toEqual(['/m/c.aiff'])
    expect(out[0].keptShared).toBe(true)
  })

  it('compares the kept and removed files across pairs by their real path', async () => {
    const d = register({
      realpath: vi.fn(async (p: string) => (p === '/m/alias-a.aiff' ? '/m/a.aiff' : p)),
    })
    await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/a.aiff', '/m/b.aiff'),
      removal('/m/c.aiff', '/m/alias-a.aiff'),
    ])
    expect(trashed(d)).toEqual(['/m/c.aiff'])
  })

  it('keeps a file named twice for removal', async () => {
    const d = register()
    await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/a.aiff', '/m/b.aiff'),
      removal('/m/a.aiff', '/m/c.aiff'),
    ])
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('keeps both files of two pairs that each keep the other', async () => {
    const d = register()
    await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/a.aiff', '/m/b.aiff'),
      removal('/m/b.aiff', '/m/a.aiff'),
    ])
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('keeps the file when the renderer could not ask Music', async () => {
    const d = register()
    const out = await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/old.aiff', '/m/keep.aiff', 'unknown'),
    ])
    expect(out).toEqual([
      {
        from: '/m/old.aiff',
        music: 'unknown',
        fileTrashed: false,
        keptForLibrary: false,
        keptForMusic: true,
      },
    ])
    expect(d.music.filePaths).not.toHaveBeenCalled()
  })

  // The renderer's lookup goes by title: a track renamed in Music is not found there.
  it('reads Music once for every file it found no entry for and keeps the ones Music holds', async () => {
    const d = register()
    d.music.filePaths.mockResolvedValue(['/M/Caf\u0065\u0301.aiff'])
    const out = (await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/Caf\u00e9.aiff', '/m/keep1.aiff'),
      removal('/m/free.aiff', '/m/keep2.aiff'),
    ])) as { music?: string; keptForMusic?: boolean }[]
    expect(d.music.filePaths).toHaveBeenCalledTimes(1)
    expect(out[0]).toMatchObject({ music: 'held', keptForMusic: true })
    expect(out[1]).toMatchObject({ music: 'none', fileTrashed: true })
    expect(trashed(d)).toEqual(['/m/free.aiff'])
    expect(sender.send).toHaveBeenCalledTimes(1)
    expect(sender.send).toHaveBeenCalledWith('listreview:removalPhase', 'checking-music')
  })

  it('keeps every file it could not check against Music', async () => {
    const d = register()
    d.music.filePaths.mockRejectedValue(new Error('osascript'))
    const out = await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/old.aiff', '/m/keep.aiff'),
    ])
    expect(out).toEqual([
      {
        from: '/m/old.aiff',
        music: 'failed',
        fileTrashed: false,
        keptForLibrary: false,
        keptForMusic: true,
      },
    ])
    expect(d.trash).not.toHaveBeenCalled()
  })

  // The bulk read takes about 40 s on a NAS library: only when a file really needs it.
  it('reads Music only for a file it found no entry for', async () => {
    const d = register()
    await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/old.aiff', '/m/keep.aiff', musicRef),
      removal('/m/two.aiff', '/m/keep2.aiff', 'ambiguous'),
    ])
    expect(d.music.filePaths).not.toHaveBeenCalled()
  })

  it('reads Music only for a file that is really leaving', async () => {
    const kept = register({
      replace: {
        libraries: {},
        usedByLibrary: vi.fn().mockResolvedValue(true),
        serial: (task: () => Promise<unknown>) => task(),
        warn: vi.fn(),
      },
    })
    await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/old.aiff', '/m/keep.aiff'),
    ])
    expect(kept.music.filePaths).not.toHaveBeenCalled()
  })
})
