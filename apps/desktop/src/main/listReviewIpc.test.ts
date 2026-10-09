import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { ipcMain } from 'electron'
import type { ActivityEvent } from '../shared/types'
import { createActivity } from './activity'
import { registerListReviewIpc } from './listReviewIpc'
import { createMusicReviewLog } from './musicReviewLog'

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

describe('listreview:applyFixes in Activity', () => {
  // One row per run, its fields named by the titles the list showed, and the run kept so an
  // undo lands under it.
  it('logs the run under its own group and remembers it for the undo', async () => {
    const activity = createActivity()
    const events: ActivityEvent[] = []
    activity.subscribe((e) => events.push(e))
    const reviewLog = createMusicReviewLog()
    registerListReviewIpc({
      apply: {
        allowed: () => true,
        exists: async () => true,
        rewrite: async () => ({ outcomes: ['written'], backup: { id: 'b1' } }),
        setMusicField: async () => 'set',
      },
      log: { track: activity.track, reviewLog },
    } as never)
    await handlerFor('listreview:applyFixes')(
      { sender },
      {
        fixes: [{ id: '/m/a.aiff', field: 'artist', from: 'a', to: 'b' }],
        music: { '/m/a.aiff': 'PA' },
        titles: { '/m/a.aiff': 'Funk Freak' },
      },
    )
    const group = events[0].group as string
    expect(group).toMatch(/^list-review-/)
    expect(events[0]).toMatchObject({
      labelParams: { title: 'Funk Freak' },
      groupLabelKey: 'activity.listReviewRun',
      groupLabelParams: { count: 1 },
    })
    expect(reviewLog.groupOf('PA')).toBe(group)
    expect(reviewLog.backup('b1')).toEqual({ group, title: 'Funk Freak' })
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
        fileLocations: vi.fn().mockResolvedValue([] as { persistentId: string; path: string }[]),
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

  // Two mounts of one share, or a hard link, resolve to different paths for the same audio.
  describe('the same file under paths realpath tells apart', () => {
    const id = (over: Record<string, unknown>) => ({
      dev: 1,
      ino: 1,
      size: 100,
      mtimeMs: 5,
      remote: false,
      ...over,
    })
    const remove = async (d: ReturnType<typeof register>) => {
      await handlerFor('listreview:removeDuplicates')({ sender }, [
        removal('/m/a.aiff', '/m/b.aiff'),
      ])
      return d
    }

    it('leaves a copy alone when its device and inode are the kept copy’s', async () => {
      const d = await remove(register({ identity: vi.fn(async () => id({})) }))
      expect(d.trash).not.toHaveBeenCalled()
    })

    it('leaves a network copy alone when its size and date match the kept copy’s', async () => {
      const d = await remove(
        register({
          identity: vi.fn(async (p: string) =>
            id({ remote: true, dev: p === '/m/a.aiff' ? 1 : 2, ino: p === '/m/a.aiff' ? 7 : 9 }),
          ),
        }),
      )
      expect(d.trash).not.toHaveBeenCalled()
    })

    it('still removes a local copy that only shares size and date with the kept one', async () => {
      const d = await remove(
        register({ identity: vi.fn(async (p: string) => id({ ino: p === '/m/a.aiff' ? 7 : 9 })) }),
      )
      expect(d.trash).toHaveBeenCalledWith('/m/a.aiff')
    })

    it('leaves a copy alone when it is another pair’s kept copy by inode', async () => {
      const d = register({
        identity: vi.fn(async (p: string) =>
          id({ ino: p === '/m/a.aiff' || p === '/m/d.aiff' ? 7 : p.length }),
        ),
      })
      await handlerFor('listreview:removeDuplicates')({ sender }, [
        removal('/m/a.aiff', '/m/b.aiff'),
        removal('/m/c.aiff', '/m/d.aiff'),
      ])
      expect(d.trash).not.toHaveBeenCalledWith('/m/a.aiff')
    })
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

  // The renderer's lookup goes by title: a track renamed in Music is not found there.
  it('reads Music once for every file it found no entry for and keeps the ones Music holds', async () => {
    const d = register()
    d.music.fileLocations.mockResolvedValue([
      { persistentId: 'OTHER', path: '/M/Caf\u0065\u0301.aiff' },
    ])
    const out = (await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/Caf\u00e9.aiff', '/m/keep1.aiff'),
      removal('/m/free.aiff', '/m/keep2.aiff'),
    ])) as { music?: string; keptForMusic?: boolean }[]
    expect(d.music.fileLocations).toHaveBeenCalledTimes(1)
    expect(out[0]).toMatchObject({ music: 'held', keptForMusic: true })
    expect(out[1]).toMatchObject({ music: 'none', fileTrashed: true })
    expect(trashed(d)).toEqual(['/m/free.aiff'])
    expect(sender.send).toHaveBeenCalledTimes(1)
    expect(sender.send).toHaveBeenCalledWith('listreview:removalPhase', 'checking-music')
  })

  it('keeps every file it could not check against Music', async () => {
    const d = register()
    d.music.fileLocations.mockRejectedValue(new Error('osascript'))
    const out = await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/old.aiff', '/m/keep.aiff'),
    ])
    expect(out).toEqual([
      {
        from: '/m/old.aiff',
        music: 'unchecked',
        fileTrashed: false,
        keptForLibrary: false,
        keptForMusic: true,
      },
    ])
    expect(d.trash).not.toHaveBeenCalled()
  })

  // The bulk read takes about 40 s on a NAS library: only when a file really needs it.
  it('reads Music only when a file is about to be trashed', async () => {
    const d = register()
    await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/two.aiff', '/m/keep2.aiff', 'ambiguous'),
    ])
    expect(d.music.fileLocations).not.toHaveBeenCalled()
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
    expect(kept.music.fileLocations).not.toHaveBeenCalled()
  })

  // The title lookup found one entry; a second one, renamed in Music, points at the same file.
  it('keeps the file when another entry still points at it after the confirmed one goes', async () => {
    const d = register()
    d.music.fileLocations.mockResolvedValue([
      { persistentId: 'OLD', path: '/m/old.aiff' },
      { persistentId: 'RENAMED', path: '/M/OLD.aiff' },
    ])
    const out = await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/old.aiff', '/m/keep.aiff', musicRef),
    ])
    expect(out).toEqual([
      {
        from: '/m/old.aiff',
        music: 'held',
        musicEntryRemoved: true,
        musicPlaylists: 1,
        fileTrashed: false,
        keptForLibrary: false,
        keptForMusic: true,
      },
    ])
    expect(d.music.deleteEntry).toHaveBeenCalledWith('OLD', 'A - T', '/m/old.aiff')
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('trashes the file when the confirmed entry was the only one on it', async () => {
    const d = register()
    d.music.fileLocations.mockResolvedValue([
      { persistentId: 'OLD', path: '/m/old.aiff' },
      { persistentId: 'K', path: '/m/keep.aiff' },
    ])
    const out = await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/old.aiff', '/m/keep.aiff', musicRef),
    ])
    expect(out).toMatchObject([{ music: 'removed', fileTrashed: true }])
    expect(trashed(d)).toEqual(['/m/old.aiff'])
  })

  it('reads Music once per batch, before its first delete', async () => {
    const calls: string[] = []
    const d = register()
    d.music.fileLocations.mockImplementation(async () => {
      calls.push('scan')
      return []
    })
    d.music.deleteEntry.mockImplementation(async (_pid: string, _label: string, at: string) => {
      calls.push(`delete ${at}`)
      return at
    })
    await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/a.aiff', '/m/keep1.aiff', { ...musicRef, removePid: 'A' }),
      removal('/m/b.aiff', '/m/keep2.aiff', { ...musicRef, removePid: 'B' }),
      removal('/m/c.aiff', '/m/keep3.aiff'),
    ])
    expect(calls).toEqual(['scan', 'delete /m/a.aiff', 'delete /m/b.aiff'])
    expect(trashed(d)).toEqual(['/m/a.aiff', '/m/b.aiff', '/m/c.aiff'])
    expect(sender.send).toHaveBeenCalledTimes(1)
  })

  // Music stores the path it was given; the list may reach the same file through a link.
  it('finds a Music entry on the real file behind the removed path', async () => {
    const d = register({
      realpath: vi.fn(async (p: string) => (p === '/m/link.aiff' ? '/m/real.aiff' : p)),
    })
    d.music.fileLocations.mockResolvedValue([{ persistentId: 'OTHER', path: '/m/real.aiff' }])
    const out = await handlerFor('listreview:removeDuplicates')({ sender }, [
      removal('/m/link.aiff', '/m/keep.aiff'),
    ])
    expect(out).toMatchObject([{ music: 'held', keptForMusic: true, fileTrashed: false }])
    expect(d.trash).not.toHaveBeenCalled()
  })
})

// A list removal used to leave no trace in Activity. Each removed copy gets its own row,
// named by the title the list showed, with what Music did and then what became of the file.
describe('listreview:removeDuplicates in Activity', () => {
  function register(over: Record<string, unknown> = {}) {
    const activity = createActivity()
    const events: ActivityEvent[] = []
    activity.subscribe((e) => events.push(e))
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
        transferPlaylists: vi.fn().mockResolvedValue('2\t0'),
        deleteEntry: vi.fn().mockResolvedValue('/m/old.aiff'),
        fileLocations: vi.fn().mockResolvedValue([]),
      },
      ...over,
    }
    registerListReviewIpc({
      apply: {} as never,
      isAllowed: (p: string) => p.startsWith('/m/'),
      removal: () => d,
      log: { track: activity.track, reviewLog: createMusicReviewLog() },
    } as never)
    return { events, d }
  }
  const steps = (events: ActivityEvent[]) =>
    events
      .filter((e) => e.phase !== 'start')
      .map((e) => [e.labelKey, e.phase, e.detailKey, e.detailParams, e.groupLabel])
  const musicRef = {
    removePid: 'OLD',
    label: 'A - T',
    keep: { persistentId: 'K', label: 'A - T' },
  }

  it('says the copy left Music with its playlists, then went to the Trash', async () => {
    const { events } = register()
    await handlerFor('listreview:removeDuplicates')({ sender }, [
      { from: '/m/old.aiff', to: '/m/keep.aiff', label: 'Funk Freak', music: musicRef },
    ])
    expect(steps(events)).toEqual([
      [
        'activity.reviewDuplicateMusic',
        'done',
        'activity.reviewDuplicateRemoved',
        { count: 2 },
        'Funk Freak',
      ],
      [
        'activity.reviewDuplicateFile',
        'done',
        'activity.reviewDuplicateFileTrash',
        undefined,
        'Funk Freak',
      ],
    ])
    expect(new Set(events.map((e) => e.group)).size).toBe(1)
  })

  // A second try at the same copy is a new run: folded under the first one's row, a
  // success sat under the warning the first try left.
  it('gives each removal run of the same copy its own row', async () => {
    const { events } = register()
    const remove = () =>
      handlerFor('listreview:removeDuplicates')({ sender }, [
        { from: '/m/old.aiff', to: '/m/keep.aiff', label: 'Funk Freak', music: 'ambiguous' },
      ])
    await remove()
    await remove()
    expect(new Set(events.map((e) => e.group)).size).toBe(2)
  })

  it('says a copy Music never had was not in Music', async () => {
    const { events } = register()
    await handlerFor('listreview:removeDuplicates')({ sender }, [
      { from: '/m/old.aiff', to: '/m/keep.aiff', label: 'Funk Freak' },
    ])
    expect(steps(events).map(([key, phase, detail]) => [key, phase, detail])).toEqual([
      ['activity.reviewDuplicateMusicChecked', 'done', 'activity.listReviewDuplicateNotInMusic'],
      ['activity.reviewDuplicateFile', 'done', 'activity.reviewDuplicateFileTrash'],
    ])
  })

  it.each([
    [
      'ambiguous',
      'ambiguous',
      'activity.listReviewDuplicateAmbiguous',
      'activity.reviewDuplicateFileMusic',
    ],
    [
      'kept copy not in Music',
      { removePid: 'OLD', label: 'A - T' },
      'activity.listReviewDuplicateKeptNoEntry',
      'activity.reviewDuplicateFileMusic',
    ],
  ] as const)(
    'warns when Music keeps the copy (%s) and the file stays',
    async (_n, music, musicKey, fileKey) => {
      const { events, d } = register()
      await handlerFor('listreview:removeDuplicates')({ sender }, [
        { from: '/m/old.aiff', to: '/m/keep.aiff', label: 'Funk Freak', music },
      ])
      expect(steps(events).map(([key, phase, detail]) => [key, phase, detail])).toEqual([
        ['activity.reviewDuplicateMusicChecked', 'warn', musicKey],
        ['activity.reviewDuplicateFile', 'warn', fileKey],
      ])
      expect(d.trash).not.toHaveBeenCalled()
    },
  )

  it('says an entry left Music while another entry keeps the file', async () => {
    const { events } = register({
      music: {
        transferPlaylists: vi.fn().mockResolvedValue('1\t0'),
        deleteEntry: vi.fn().mockResolvedValue('/m/old.aiff'),
        fileLocations: vi.fn().mockResolvedValue([
          { persistentId: 'OLD', path: '/m/old.aiff' },
          { persistentId: 'OTHER', path: '/m/old.aiff' },
        ]),
      },
    })
    await handlerFor('listreview:removeDuplicates')({ sender }, [
      { from: '/m/old.aiff', to: '/m/keep.aiff', label: 'Funk Freak', music: musicRef },
    ])
    expect(
      steps(events).map(([key, phase, detail, params]) => [key, phase, detail, params]),
    ).toEqual([
      [
        'activity.reviewDuplicateMusic',
        'warn',
        'activity.listReviewDuplicateRemovedHeld',
        { count: 1 },
      ],
      ['activity.reviewDuplicateFile', 'warn', 'activity.reviewDuplicateFileMusic', undefined],
    ])
  })

  it('says Music could not be checked when its read of every location fails', async () => {
    const { events, d } = register()
    d.music.fileLocations.mockRejectedValue(new Error('Not authorized (-1743)'))
    await handlerFor('listreview:removeDuplicates')({ sender }, [
      { from: '/m/old.aiff', to: '/m/keep.aiff', label: 'Funk Freak' },
    ])
    expect(steps(events)[0][0]).toBe('activity.reviewDuplicateMusicChecked')
    expect(steps(events).map(([, phase, detail]) => [phase, detail])).toEqual([
      ['warn', 'activity.listReviewDuplicateUnchecked'],
      ['warn', 'activity.reviewDuplicateFileUnchecked'],
    ])
    expect(d.trash).not.toHaveBeenCalled()
  })

  // Music's own read found the file under an entry the load never saw; nothing left Music.
  it('names a Music step that only found the file held a check, not a removal', async () => {
    const { events, d } = register()
    d.music.fileLocations.mockResolvedValue([{ persistentId: 'OTHER', path: '/m/old.aiff' }])
    await handlerFor('listreview:removeDuplicates')({ sender }, [
      { from: '/m/old.aiff', to: '/m/keep.aiff', label: 'Funk Freak' },
    ])
    expect(steps(events)[0].slice(0, 3)).toEqual([
      'activity.reviewDuplicateMusicChecked',
      'warn',
      'activity.listReviewDuplicateHeld',
    ])
  })

  it('says only what kept the file when a DJ library still uses it', async () => {
    const { events } = register({
      replace: {
        libraries: {},
        usedByLibrary: vi.fn().mockResolvedValue(true),
        serial: (task: () => Promise<unknown>) => task(),
        warn: vi.fn(),
      },
    })
    await handlerFor('listreview:removeDuplicates')({ sender }, [
      { from: '/m/old.aiff', to: '/m/keep.aiff', label: 'Funk Freak', music: musicRef },
    ])
    expect(steps(events).map(([key, phase, detail]) => [key, phase, detail])).toEqual([
      ['activity.reviewDuplicateFile', 'done', 'activity.reviewDuplicateFileUsed'],
    ])
  })
})
