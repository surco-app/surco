import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ActivityEvent } from '../shared/types'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const READS = vi.hoisted(() => ({ readFile: vi.fn() }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  READS.readFile.mockImplementation(actual.readFile)
  return { ...actual, readFile: READS.readFile }
})

const SETTINGS = vi.hoisted(() => ({
  syncRekordbox: true,
  rekordboxDbPath: '/c/master.db',
  syncEngineDj: false,
  engineLibraryDir: '',
  syncTraktor: false,
  traktorNmlPath: '',
  addToTraktor: false,
  addToEngineDj: false,
  addToSerato: false,
  syncSerato: false,
}))
const REPOINTS = vi.hoisted(() => [
  { from: '/m/a.mp3', to: '/m/a.flac', playlists: [{ name: 'House' }] },
])

vi.mock('./settings', () => ({ getSettings: () => SETTINGS }))
vi.mock('./rekordboxPath', () => ({ findRekordboxCollection: () => '/c/master.db' }))
const STATUS = vi.hoisted(() => ({
  rekordbox: { enabled: true, found: true },
  engine: { enabled: false, found: false },
  traktor: { enabled: false, found: false },
}))
vi.mock('./libraryStatus', () => ({ libraryStatus: () => STATUS }))
const BATCH = vi.hoisted(() => ({ open: false, ends: 0 }))
vi.mock('./rekordboxBatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./rekordboxBatch')>()),
  endRekordboxBatch: () => {
    BATCH.ends += 1
    EFFECTS.push('rekordbox take')
    return BATCH.open ? [] : REPOINTS
  },
  rekordboxBatchOpen: () => BATCH.open,
}))
const EFFECTS = vi.hoisted(() => [] as string[])
vi.mock('./traktorNmlLibrary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./traktorNmlLibrary')>()
  return {
    ...actual,
    syncCollection: (...args: Parameters<typeof actual.syncCollection>) => {
      EFFECTS.push('traktor sync')
      return actual.syncCollection(...args)
    },
  }
})
const WRITERS = vi.hoisted(() => ({
  trackOpsFromRun: vi.fn(async () => []),
  repointTracks: vi.fn(async () => [{ written: true }]),
  updateRekordboxTags: vi.fn(async () => [{ written: true }]),
  replaceRekordboxDuplicates: vi.fn(async () => [{ written: true, outcome: 'replaced' }]),
  repointEngineTracks: vi.fn(async () => [{ written: true, id: '1' }]),
  updateEngineTags: vi.fn(async () => [{ written: true }]),
}))
vi.mock('./engineTags', () => ({ updateEngineTags: WRITERS.updateEngineTags }))
vi.mock('./engineRepoint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./engineRepoint')>()),
  repointEngineTracks: WRITERS.repointEngineTracks,
}))
vi.mock('./rekordboxQueueFromRun', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./rekordboxQueueFromRun')>()),
  trackOpsFromRun: WRITERS.trackOpsFromRun,
}))
vi.mock('./rekordboxLibrary', () => ({ repointTracks: WRITERS.repointTracks }))
vi.mock('./rekordboxTags', () => ({ updateRekordboxTags: WRITERS.updateRekordboxTags }))
vi.mock('./rekordboxDuplicates', () => ({
  replaceRekordboxDuplicates: WRITERS.replaceRekordboxDuplicates,
}))

const FILE_USE = vi.hoisted(() => {
  const check = vi.fn(async (_path: string) => false)
  return { check, open: vi.fn(() => check) }
})
vi.mock('./libraryFileUse', () => ({ djLibraryFileUse: FILE_USE.open }))

const ENGINE_PROCESS = vi.hoisted(() => ({ isEngineDjRunning: vi.fn(async () => false) }))
vi.mock('./engineProcess', () => ENGINE_PROCESS)
const TRAKTOR_PROCESS = vi.hoisted(() => ({ isTraktorRunning: vi.fn(async () => false) }))
vi.mock('./traktorProcess', () => TRAKTOR_PROCESS)
const REKORDBOX_PROCESS = vi.hoisted(() => ({ isRekordboxRunning: vi.fn(async () => true) }))
vi.mock('./rekordboxProcess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./rekordboxProcess')>()),
  isRekordboxRunning: REKORDBOX_PROCESS.isRekordboxRunning,
}))

import { activity } from './activity'
import { writeEngineLibraryFixture } from './enginePlaylistsFixture'
import {
  duplicateLibraryDeps,
  engineFlushDeps,
  flushConversionBatch,
  type LibraryHost,
  librariesKeepingOriginal,
  rekordboxFlushDeps,
  repointEngineQueued,
  SYNC_BLOCKED_KEY,
  SYNC_ISSUE_PROGRAMS,
  syncTagsInLibraries,
  traktorFlushDeps,
} from './libraryFlushes'
import { beginNmlBatch, endNmlBatch, recordNmlPatch } from './nmlBatch'
import { concat, frame, track, utf16be } from './seratoDatabaseFixture'
import type { SeratoLibraryRoot } from './seratoLibrary'
import { traktorPatchKey } from './verifyRegistry'

type Closers = {
  ensureTraktorClosed: () => Promise<boolean>
  ensureRekordboxClosed: () => Promise<boolean>
  ensureEngineDjClosed: () => Promise<boolean>
}

function host(overrides: Partial<Closers & LibraryHost> = {}) {
  const closers: Closers = {
    ensureTraktorClosed: vi.fn(async () => true),
    ensureRekordboxClosed: vi.fn(async () => false),
    ensureEngineDjClosed: vi.fn(async () => true),
  }
  const { ensureTraktorClosed, ensureRekordboxClosed, ensureEngineDjClosed, ...rest } = {
    ...closers,
    ...overrides,
  }
  const byProgram = {
    traktor: ensureTraktorClosed,
    rekordbox: ensureRekordboxClosed,
    engine: ensureEngineDjClosed,
  }
  return {
    ensureClosed: (program) => byProgram[program](),
    showBlockedDialog: vi.fn(),
    reportIssue: vi.fn(),
    rekordboxHeld: () => false,
    ...rest,
    ensureTraktorClosed,
    ensureRekordboxClosed,
    ensureEngineDjClosed,
  } satisfies LibraryHost & Closers
}

const fakeSession = () => ({
  ensure: vi.fn(async () => {}),
  begin: vi.fn(),
  beginLoose: vi.fn(),
  inRunFlush: vi.fn(),
  ensureForRun: vi.fn(async () => {}),
  endRun: vi.fn(),
  failed: () => new Set<string>(),
})

const sessions = {
  traktor: fakeSession(),
  rekordbox: {
    ensure: vi.fn(async () => {}),
    begin: vi.fn(),
    beginLoose: vi.fn(),
    inRunFlush: vi.fn(),
    ensureForRun: vi.fn(async () => {}),
    endRun: vi.fn(),
    failed: () => new Set<string>(),
  },
  engine: {
    ensure: vi.fn(async () => {}),
    begin: vi.fn(),
    beginLoose: vi.fn(),
    inRunFlush: vi.fn(),
    ensureForRun: vi.fn(async () => {}),
    endRun: vi.fn(),
    failed: () => new Set<string>(),
  },
}

describe('flushConversionBatch with rekordbox open', () => {
  it('queues the run instead of showing the blocked dialog, because the queue applies it later', async () => {
    const h = host()
    const queue = { enqueue: vi.fn(), applyQuietly: vi.fn() }
    await flushConversionBatch(h, sessions, { rekordbox: queue })
    expect(h.showBlockedDialog).not.toHaveBeenCalled()
    expect(queue.enqueue).toHaveBeenCalledWith([], REPOINTS)
    expect(queue.applyQuietly).toHaveBeenCalled()
  })
})

describe('flushConversionBatch with rekordbox open and its queue waiting', () => {
  it('queues the repoints without asking to close rekordbox, since the queue applies them once it closes', async () => {
    const h = host()
    const queue = { enqueue: vi.fn(), applyQuietly: vi.fn() }
    await flushConversionBatch(h, sessions, { rekordbox: queue })
    expect(h.ensureRekordboxClosed).not.toHaveBeenCalled()
    expect(queue.enqueue).toHaveBeenCalledWith([], REPOINTS)
  })

  it('treats an unanswered check for rekordbox as open and queues, because writing under a live rekordbox loses the library', async () => {
    REKORDBOX_PROCESS.isRekordboxRunning.mockRejectedValueOnce(new Error('pgrep missing'))
    WRITERS.repointTracks.mockClear()
    const h = host({ ensureRekordboxClosed: vi.fn(async () => true) })
    const queue = { enqueue: vi.fn(), applyQuietly: vi.fn() }
    await flushConversionBatch(h, sessions, { rekordbox: queue })
    expect(WRITERS.repointTracks).not.toHaveBeenCalled()
    expect(queue.enqueue).toHaveBeenCalledWith([], REPOINTS)
  })

  it('repoints right away when rekordbox is closed', async () => {
    REKORDBOX_PROCESS.isRekordboxRunning.mockResolvedValueOnce(false)
    WRITERS.repointTracks.mockClear()
    await flushConversionBatch(host(), sessions, {
      rekordbox: { enqueue: vi.fn(), applyQuietly: vi.fn() },
    })
    expect(WRITERS.repointTracks).toHaveBeenCalled()
  })
})

describe('flushConversionBatch with Traktor open', () => {
  const patch = { volume: 'HD', dir: '/:m/:', file: 'a.aiff', newFile: 'a.flac' }
  const traktorQueue = () => ({
    enqueue: vi.fn(),
    applyQuietly: vi.fn(),
    state: () => ({ tracks: 0, changes: 0, items: [] }),
  })
  async function withTraktorOpen(run: () => Promise<void>) {
    Object.assign(SETTINGS, { syncTraktor: true, traktorNmlPath: '/c/collection.nml' })
    STATUS.traktor = { enabled: true, found: true }
    TRAKTOR_PROCESS.isTraktorRunning.mockResolvedValue(true)
    beginNmlBatch()
    recordNmlPatch(patch)
    try {
      await run()
    } finally {
      TRAKTOR_PROCESS.isTraktorRunning.mockResolvedValue(false)
      Object.assign(SETTINGS, { syncTraktor: false, traktorNmlPath: '' })
      STATUS.traktor = { enabled: false, found: false }
    }
  }

  it('holds the run in the Traktor queue without asking to close Traktor or showing the blocked dialog', async () => {
    await withTraktorOpen(async () => {
      const h = host()
      const traktor = traktorQueue()
      await flushConversionBatch(h, sessions, {
        rekordbox: { enqueue: vi.fn(), applyQuietly: vi.fn() },
        traktor,
      })
      expect(h.ensureTraktorClosed).not.toHaveBeenCalled()
      expect(h.showBlockedDialog).not.toHaveBeenCalled()
      expect(traktor.enqueue).toHaveBeenCalledWith([], [expect.objectContaining({ patch })])
    })
  })

  it('treats an unanswered check for Traktor as open and holds the run, because Traktor rewrites collection.nml when it quits', async () => {
    await withTraktorOpen(async () => {
      TRAKTOR_PROCESS.isTraktorRunning.mockRejectedValue(new Error('pgrep missing'))
      EFFECTS.length = 0
      const h = host()
      const traktor = traktorQueue()
      await flushConversionBatch(h, sessions, {
        rekordbox: { enqueue: vi.fn(), applyQuietly: vi.fn() },
        traktor,
      })
      expect(h.ensureTraktorClosed).not.toHaveBeenCalled()
      expect(EFFECTS).not.toContain('traktor sync')
      expect(traktor.enqueue).toHaveBeenCalledWith([], [expect.objectContaining({ patch })])
    })
  })

  it('still asks to close Traktor when there is no queue to hold the run', async () => {
    await withTraktorOpen(async () => {
      const h = host({ ensureTraktorClosed: vi.fn(async () => false) })
      await flushConversionBatch(h, sessions, {
        rekordbox: { enqueue: vi.fn(), applyQuietly: vi.fn() },
      })
      expect(h.ensureTraktorClosed).toHaveBeenCalled()
    })
  })
})

describe('flushConversionBatch with master.db on an unplugged drive', () => {
  it('queues the repoints for when the drive is back instead of letting them go', async () => {
    Object.assign(SETTINGS, { rekordboxDbPath: '/Volumes/Surco Desconectado/master.db' })
    STATUS.rekordbox = { enabled: true, found: false }
    try {
      const queue = { enqueue: vi.fn(), applyQuietly: vi.fn() }
      await flushConversionBatch(host(), sessions, { rekordbox: queue })
      expect(queue.enqueue).toHaveBeenCalledWith([], REPOINTS)
    } finally {
      Object.assign(SETTINGS, { rekordboxDbPath: '/c/master.db' })
      STATUS.rekordbox = { enabled: true, found: true }
    }
  })

  it('tells the DJ in Activity the changes land when the drive is connected', async () => {
    Object.assign(SETTINGS, { rekordboxDbPath: '/Volumes/Surco Desconectado/master.db' })
    STATUS.rekordbox = { enabled: true, found: false }
    const events: ActivityEvent[] = []
    const stop = activity.subscribe((event) => events.push(event))
    try {
      await flushConversionBatch(host(), sessions, {
        rekordbox: { enqueue: vi.fn(), applyQuietly: vi.fn() },
      })
    } finally {
      stop()
      Object.assign(SETTINGS, { rekordboxDbPath: '/c/master.db' })
      STATUS.rekordbox = { enabled: true, found: true }
    }
    expect(events).toContainEqual(
      expect.objectContaining({
        labelKey: 'activity.rekordboxSync',
        detailKey: 'activity.rekordboxCollectionUnplugged',
      }),
    )
  })
})

// Engine DJ abierto al acabar una conversión en su sitio: el aviso pedía volver a convertir,
// y el MP3 ya no existe. La biblioteca se queda en la cola y apunta al FLAC al cerrar Engine.
describe('flushConversionBatch with Engine DJ open', () => {
  async function withEngineOpen(running: () => Promise<boolean>, run: () => Promise<void>) {
    Object.assign(SETTINGS, { syncEngineDj: true, engineLibraryDir: '/e/Engine Library' })
    STATUS.engine = { enabled: true, found: true }
    ENGINE_PROCESS.isEngineDjRunning.mockImplementation(running)
    try {
      await run()
    } finally {
      ENGINE_PROCESS.isEngineDjRunning.mockImplementation(async () => false)
      Object.assign(SETTINGS, { syncEngineDj: false, engineLibraryDir: '' })
      STATUS.engine = { enabled: false, found: false }
    }
  }

  it('queues the repoints for when Engine DJ closes without asking to close it, since the queue applies them later', async () => {
    await withEngineOpen(
      async () => true,
      async () => {
        const h = host({ ensureEngineDjClosed: vi.fn(async () => false) })
        const engine = { enqueue: vi.fn(), applyQuietly: vi.fn() }
        await flushConversionBatch(h, sessions, {
          rekordbox: { enqueue: vi.fn(), applyQuietly: vi.fn() },
          engine: engine,
        })
        expect(h.ensureEngineDjClosed).not.toHaveBeenCalled()
        expect(h.showBlockedDialog).not.toHaveBeenCalledWith('engineSyncBlocked')
        expect(engine.enqueue).toHaveBeenCalledWith([], REPOINTS)
        expect(engine.applyQuietly).toHaveBeenCalled()
      },
    )
  })

  it('treats an unanswered check for Engine DJ as open and queues, because writing under a live Engine loses the library', async () => {
    await withEngineOpen(
      async () => {
        throw new Error('pgrep missing')
      },
      async () => {
        WRITERS.repointEngineTracks.mockClear()
        const h = host()
        const engine = { enqueue: vi.fn(), applyQuietly: vi.fn() }
        await flushConversionBatch(h, sessions, {
          rekordbox: { enqueue: vi.fn(), applyQuietly: vi.fn() },
          engine: engine,
        })
        expect(h.ensureEngineDjClosed).not.toHaveBeenCalled()
        expect(WRITERS.repointEngineTracks).not.toHaveBeenCalled()
        expect(engine.enqueue).toHaveBeenCalledWith([], REPOINTS)
      },
    )
  })

  it('writes the names a conversion changed into Engine DJ after moving the row, so Engine shows the new title', async () => {
    Object.assign(REPOINTS[0], { names: { title: { from: 'Old', to: 'New' } } })
    try {
      await withEngineOpen(
        async () => false,
        async () => {
          WRITERS.updateEngineTags.mockClear()
          await flushConversionBatch(host(), sessions, {
            rekordbox: { enqueue: vi.fn(), applyQuietly: vi.fn() },
            engine: { enqueue: vi.fn(), applyQuietly: vi.fn() },
          })
          expect(WRITERS.updateEngineTags).toHaveBeenCalledWith(
            '/e/Engine Library',
            [
              expect.objectContaining({
                path: '/m/a.flac',
                fields: { title: { from: 'Old', to: 'New' } },
              }),
            ],
            expect.anything(),
          )
        },
      )
    } finally {
      delete (REPOINTS[0] as Record<string, unknown>).names
    }
  })

  it('writes no names into Engine DJ while it waits for Engine to close', async () => {
    Object.assign(REPOINTS[0], { names: { title: { from: 'Old', to: 'New' } } })
    try {
      await withEngineOpen(
        async () => true,
        async () => {
          WRITERS.updateEngineTags.mockClear()
          await flushConversionBatch(host(), sessions, {
            rekordbox: { enqueue: vi.fn(), applyQuietly: vi.fn() },
            engine: { enqueue: vi.fn(), applyQuietly: vi.fn() },
          })
          expect(WRITERS.updateEngineTags).not.toHaveBeenCalled()
        },
      )
    } finally {
      delete (REPOINTS[0] as Record<string, unknown>).names
    }
  })

  it('still asks to close Engine DJ when there is no queue to leave the repoints in', async () => {
    await withEngineOpen(
      async () => true,
      async () => {
        const h = host({ ensureEngineDjClosed: vi.fn(async () => false) })
        await flushConversionBatch(h, sessions, {
          rekordbox: { enqueue: vi.fn(), applyQuietly: vi.fn() },
        })
        expect(h.ensureEngineDjClosed).toHaveBeenCalled()
      },
    )
  })

  it('queues the repoints while the Engine library is on an unplugged drive', async () => {
    Object.assign(SETTINGS, {
      syncEngineDj: true,
      engineLibraryDir: '/Volumes/Surco Desconectado/Engine Library',
    })
    try {
      const engine = { enqueue: vi.fn(), applyQuietly: vi.fn() }
      await flushConversionBatch(host(), sessions, {
        rekordbox: { enqueue: vi.fn(), applyQuietly: vi.fn() },
        engine: engine,
      })
      expect(engine.enqueue).toHaveBeenCalledWith([], REPOINTS)
    } finally {
      Object.assign(SETTINGS, { syncEngineDj: false, engineLibraryDir: '' })
    }
  })

  it('tells the DJ in Activity the Engine changes land when the drive is connected', async () => {
    Object.assign(SETTINGS, {
      syncEngineDj: true,
      engineLibraryDir: '/Volumes/Surco Desconectado/Engine Library',
    })
    const events: ActivityEvent[] = []
    const stop = activity.subscribe((event) => events.push(event))
    try {
      await flushConversionBatch(host(), sessions, {
        rekordbox: { enqueue: vi.fn(), applyQuietly: vi.fn() },
        engine: { enqueue: vi.fn(), applyQuietly: vi.fn() },
      })
    } finally {
      stop()
      Object.assign(SETTINGS, { syncEngineDj: false, engineLibraryDir: '' })
    }
    expect(events).toContainEqual(
      expect.objectContaining({
        labelKey: 'activity.engineSync',
        detailKey: 'activity.engineCollectionUnplugged',
      }),
    )
  })

  // La cola solo guarda los cambios cuando la razón es la suya de "app abierta". Con la de
  // Engine tal cual, un Engine abierto justo antes de escribir tiraba la cola entera.
  it('writes the names a conversion changed once the queued move lands, so a run made while Engine was open still renames the track', async () => {
    WRITERS.updateEngineTags.mockClear()
    const named = [{ ...REPOINTS[0], names: { title: { from: 'Old', to: 'New' } } }]
    await repointEngineQueued('/e/Engine Library', named, sessions)
    expect(WRITERS.updateEngineTags).toHaveBeenCalledWith(
      '/e/Engine Library',
      [
        expect.objectContaining({
          path: '/m/a.flac',
          fields: { title: { from: 'Old', to: 'New' } },
        }),
      ],
      expect.anything(),
    )
  })

  it('writes no names for a move that is still waiting', async () => {
    WRITERS.updateEngineTags.mockClear()
    WRITERS.repointEngineTracks.mockResolvedValueOnce([
      { written: false, reason: 'engine-running' },
    ] as never)
    const named = [{ ...REPOINTS[0], names: { title: { from: 'Old', to: 'New' } } }]
    await repointEngineQueued('/e/Engine Library', named, sessions)
    expect(WRITERS.updateEngineTags).not.toHaveBeenCalled()
  })

  it('names Engine DJ being open the way the queue keeps waiting on', async () => {
    WRITERS.repointEngineTracks.mockResolvedValueOnce([
      { written: false, reason: 'engine-running' },
    ] as never)
    const results = await repointEngineQueued('/e/Engine Library', REPOINTS, sessions)
    expect(results).toEqual([{ written: false, reason: 'rekordbox-running' }])
  })
})

describe('rekordbox writes while the queue is held after a write left the collection unknown', () => {
  const held = () =>
    host({ ensureRekordboxClosed: vi.fn(async () => true), rekordboxHeld: () => true })

  it('keeps the conversion run in the queue instead of repointing, so master.db.surco-backup stays the good copy', async () => {
    WRITERS.repointTracks.mockClear()
    const queue = { enqueue: vi.fn(), applyQuietly: vi.fn() }
    await flushConversionBatch(held(), sessions, { rekordbox: queue })
    expect(WRITERS.repointTracks).not.toHaveBeenCalled()
    expect(queue.enqueue).toHaveBeenCalledWith([], REPOINTS)
  })

  it('reads the run playlists by where each track came from, because its repoint waits in the queue', async () => {
    WRITERS.trackOpsFromRun.mockClear()
    await flushConversionBatch(held(), sessions, {
      rekordbox: { enqueue: vi.fn(), applyQuietly: vi.fn() },
    })
    expect(WRITERS.trackOpsFromRun).toHaveBeenCalledWith(
      '/c/master.db',
      REPOINTS,
      expect.objectContaining({ repointing: true }),
    )
  })

  it('does not write Update tags into the collection, so master.db.surco-backup stays the good copy', async () => {
    WRITERS.updateRekordboxTags.mockClear()
    await syncTagsInLibraries([{ path: '/m/a.flac', fields: {} }], held(), sessions, vi.fn())
    expect(WRITERS.updateRekordboxTags).not.toHaveBeenCalled()
  })

  it('hands Serato the review only when its sync is on, and reports nothing for it without a Serato queue', async () => {
    const update = [{ path: '/m/a.flac', fields: { title: { from: 'a', to: 'b' } } }]
    const serato = {
      roots: () => [],
      queue: { enqueue: vi.fn(), apply: vi.fn(), drop: vi.fn(), queuedOps: vi.fn(() => []) },
      isRunning: async () => false,
      onWaiting: vi.fn(),
      onApplied: vi.fn(),
    }
    expect((await syncTagsInLibraries(update, held(), sessions, vi.fn())).serato).toEqual({
      outcome: 'nothing',
    })
    expect((await syncTagsInLibraries(update, held(), sessions, vi.fn(), serato)).serato).toEqual({
      outcome: 'nothing',
    })
    Object.assign(SETTINGS, { syncSerato: true })
    try {
      expect((await syncTagsInLibraries(update, held(), sessions, vi.fn(), serato)).serato).toEqual(
        { outcome: 'missing' },
      )
    } finally {
      Object.assign(SETTINGS, { syncSerato: false })
    }
  })

  it('a review with nothing to sync begins no momento, so it cannot end the one in progress', async () => {
    const begin = vi.fn()
    await syncTagsInLibraries(
      [],
      host({ ensureRekordboxClosed: vi.fn(async () => true) }),
      sessions,
      begin,
    )
    expect(begin).not.toHaveBeenCalled()
    await syncTagsInLibraries(
      [{ path: '/m/a.flac', fields: {} }],
      host({ ensureRekordboxClosed: vi.fn(async () => true) }),
      sessions,
      begin,
    )
    expect(begin).toHaveBeenCalledTimes(1)
  })

  it('still writes Update tags when the queue is not held', async () => {
    WRITERS.updateRekordboxTags.mockClear()
    await syncTagsInLibraries(
      [{ path: '/m/a.flac', fields: {} }],
      host({ ensureRekordboxClosed: vi.fn(async () => true) }),
      sessions,
      vi.fn(),
    )
    expect(WRITERS.updateRekordboxTags).toHaveBeenCalled()
  })

  it('hands the duplicate writer the hold, and keeps rekordbox in the step so the removed copy is not trashed', async () => {
    WRITERS.replaceRekordboxDuplicates.mockClear()
    const deps = duplicateLibraryDeps(held(), sessions, () => [])
    await deps.libraries.rekordbox?.([{ from: '/m/a.mp3', to: '/m/b.mp3' }])
    const [, , options] = WRITERS.replaceRekordboxDuplicates.mock.calls[0] as unknown as [
      string,
      unknown,
      { held: () => boolean },
    ]
    expect(options.held()).toBe(true)
  })
})

describe('duplicateLibraryDeps', () => {
  // The check runs once per removed copy; opening the libraries afresh for each one
  // re-read Engine's database and the whole collection.nml every time.
  it('checks every removed copy against the libraries loaded once for the run', async () => {
    FILE_USE.open.mockClear()
    const deps = duplicateLibraryDeps(host(), sessions, () => [])
    await deps.usedByLibrary('/m/a.mp3')
    await deps.usedByLibrary('/m/b.mp3')
    expect(FILE_USE.open).toHaveBeenCalledTimes(1)
    expect(FILE_USE.check.mock.calls).toEqual([['/m/a.mp3'], ['/m/b.mp3']])
  })

  it('asks Serato too, so a removed copy a crate still plays is not trashed', () => {
    FILE_USE.open.mockClear()
    const roots = [{ dir: '/Users/v/Music/_Serato_', root: '/' }]
    duplicateLibraryDeps(host(), sessions, () => roots)
    expect(FILE_USE.open).toHaveBeenCalledWith(
      expect.objectContaining({ serato: roots }),
      expect.anything(),
    )
  })
})

// Los campos de playlists de Traktor y Engine DJ escriben por la cola de cada programa, que
// espera a que esté cerrado, tenga o no activado el reapuntado de esa biblioteca.
describe('flushConversionBatch with playlists chosen for Traktor and Engine DJ', () => {
  it('queues each library its own track ops and applies them quietly', async () => {
    Object.assign(REPOINTS[0], {
      traktorPlaylists: { wanted: [{ id: 'fri', name: 'Friday' }], base: [] },
      enginePlaylists: { wanted: [], base: ['7'] },
    })
    try {
      const traktor = {
        enqueue: vi.fn(),
        applyQuietly: vi.fn(),
        state: () => ({ tracks: 0, changes: 0, items: [] }),
      }
      const engine = { enqueue: vi.fn(), applyQuietly: vi.fn() }
      await flushConversionBatch(host(), sessions, {
        rekordbox: { enqueue: vi.fn(), applyQuietly: vi.fn() },
        traktor: traktor,
        engine: engine,
      })
      expect(traktor.enqueue).toHaveBeenCalledWith([
        expect.objectContaining({
          kind: 'track',
          path: '/m/a.flac',
          from: '/m/a.mp3',
          wanted: [{ id: 'fri', name: 'Friday' }],
        }),
      ])
      expect(traktor.applyQuietly).toHaveBeenCalled()
      expect(engine.enqueue).toHaveBeenCalledWith([
        expect.objectContaining({ kind: 'track', path: '/m/a.flac', known: ['7'] }),
      ])
      expect(engine.applyQuietly).toHaveBeenCalled()
    } finally {
      const first = REPOINTS[0] as Record<string, unknown>
      delete first.traktorPlaylists
      delete first.enginePlaylists
    }
  })
})

describe('flushConversionBatch with a converted track Traktor does not have', () => {
  const traktorQueue = () => ({
    enqueue: vi.fn(),
    applyQuietly: vi.fn(),
    state: () => ({ tracks: 0, changes: 0, items: [] }),
  })
  const flush = (traktor: ReturnType<typeof traktorQueue>) =>
    flushConversionBatch(host(), sessions, {
      rekordbox: { enqueue: vi.fn(), applyQuietly: vi.fn() },
      traktor: traktor,
    })

  it('asks Traktor to register it when the DJ chose to add new tracks there', async () => {
    Object.assign(REPOINTS[0], { meta: { artist: 'Jaydee', title: 'Plastic Dreams' } })
    Object.assign(SETTINGS, { addToTraktor: true })
    try {
      const traktor = traktorQueue()
      await flush(traktor)
      expect(traktor.enqueue).toHaveBeenCalledWith([
        expect.objectContaining({ kind: 'track', path: '/m/a.flac', add: true, wanted: [] }),
      ])
      expect(traktor.applyQuietly).toHaveBeenCalled()
    } finally {
      delete (REPOINTS[0] as Record<string, unknown>).meta
      Object.assign(SETTINGS, { addToTraktor: false })
    }
  })

  it('asks the Traktor collection which converted tracks it already has, so the queue does not promise adding one it holds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surco-flush-nml-'))
    const nmlPath = join(dir, 'collection.nml')
    await writeFile(
      nmlPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<NML VERSION="20"><COLLECTION ENTRIES="1">
<ENTRY TITLE="Plastic Dreams" ARTIST="Jaydee"><LOCATION DIR="/:m/:" FILE="a.flac" VOLUME="" VOLUMEID=""></LOCATION>
</ENTRY>
</COLLECTION>
<PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="0"></SUBNODES>
</NODE>
</PLAYLISTS>
</NML>
`,
    )
    Object.assign(REPOINTS[0], { meta: { artist: 'Jaydee', title: 'Plastic Dreams' } })
    Object.assign(SETTINGS, { addToTraktor: true, traktorNmlPath: nmlPath })
    try {
      const traktor = traktorQueue()
      await flush(traktor)
      expect(traktor.enqueue).not.toHaveBeenCalled()
    } finally {
      delete (REPOINTS[0] as Record<string, unknown>).meta
      Object.assign(SETTINGS, { addToTraktor: false, traktorNmlPath: '' })
    }
  })

  it('counts a track Traktor has under the file it was converted from only while Traktor follows moves, since only then a repoint brings that entry over', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surco-flush-nml-'))
    const nmlPath = join(dir, 'collection.nml')
    await writeFile(
      nmlPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<NML VERSION="20"><COLLECTION ENTRIES="1">
<ENTRY TITLE="Plastic Dreams" ARTIST="Jaydee"><LOCATION DIR="/:m/:" FILE="a.mp3" VOLUME="" VOLUMEID=""></LOCATION>
</ENTRY>
</COLLECTION>
<PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="0"></SUBNODES>
</NODE>
</PLAYLISTS>
</NML>
`,
    )
    Object.assign(REPOINTS[0], { meta: { artist: 'Jaydee', title: 'Plastic Dreams' } })
    Object.assign(SETTINGS, { addToTraktor: true, traktorNmlPath: nmlPath })
    try {
      const unsynced = traktorQueue()
      await flush(unsynced)
      expect(unsynced.enqueue).toHaveBeenCalledWith([
        expect.objectContaining({ path: '/m/a.flac', add: true }),
      ])
      Object.assign(SETTINGS, { syncTraktor: true })
      const synced = traktorQueue()
      await flush(synced)
      expect(synced.enqueue).not.toHaveBeenCalledWith([
        expect.objectContaining({ path: '/m/a.flac', add: true }),
      ])
    } finally {
      delete (REPOINTS[0] as Record<string, unknown>).meta
      Object.assign(SETTINGS, { addToTraktor: false, traktorNmlPath: '', syncTraktor: false })
    }
  })

  it('does not read collection.nml when no converted track could be added, since a large collection costs every run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surco-flush-nml-'))
    const nmlPath = join(dir, 'collection.nml')
    await writeFile(nmlPath, '<NML VERSION="20"><COLLECTION ENTRIES="0"></COLLECTION></NML>')
    Object.assign(SETTINGS, { addToTraktor: true, traktorNmlPath: nmlPath })
    READS.readFile.mockClear()
    try {
      const traktor = traktorQueue()
      await flush(traktor)
      expect(READS.readFile).not.toHaveBeenCalledWith(nmlPath, expect.anything())
      expect(traktor.enqueue).not.toHaveBeenCalled()
    } finally {
      Object.assign(SETTINGS, { addToTraktor: false, traktorNmlPath: '' })
    }
  })

  it('leaves it out of Traktor when the DJ only updates the tracks already there', async () => {
    Object.assign(REPOINTS[0], { meta: { artist: 'Jaydee', title: 'Plastic Dreams' } })
    try {
      const traktor = traktorQueue()
      await flush(traktor)
      expect(traktor.enqueue).not.toHaveBeenCalled()
    } finally {
      delete (REPOINTS[0] as Record<string, unknown>).meta
    }
  })
})

describe('flushConversionBatch with a converted track Serato does not have', () => {
  function seratoHome(paths: string[]): SeratoLibraryRoot[] {
    const dir = mkdtempSync(join(tmpdir(), 'surco-flush-serato-'))
    const vrsn = frame('vrsn', utf16be('2.0/Serato Scratch LIVE Database'))
    writeFileSync(
      join(dir, 'database V2'),
      concat([vrsn, ...paths.map((pfil) => track({ ttyp: 'mp3', pfil }))]),
    )
    return [{ dir, root: '/' }]
  }
  async function withRun(addToSerato: boolean, run: () => Promise<void>) {
    Object.assign(REPOINTS[0], { meta: { artist: 'Jaydee', title: 'Plastic Dreams' } })
    Object.assign(SETTINGS, { addToSerato })
    try {
      await run()
    } finally {
      delete (REPOINTS[0] as Record<string, unknown>).meta
      Object.assign(SETTINGS, { addToSerato: false })
    }
  }
  const flush = (serato: {
    enqueue: () => void
    applyQuietly: () => void
    roots: () => SeratoLibraryRoot[]
  }) =>
    flushConversionBatch(host(), sessions, {
      rekordbox: { enqueue: vi.fn(), applyQuietly: vi.fn() },
      serato,
    })

  it('queues Serato adds after the three libraries of today, only with addToSerato on', async () => {
    const roots = seratoHome([])
    const serato = { enqueue: vi.fn(), applyQuietly: vi.fn(), roots: () => roots }
    await withRun(true, async () => {
      await flush(serato)
      expect(serato.enqueue).toHaveBeenCalledWith([
        expect.objectContaining({ kind: 'track', add: true, path: '/m/a.flac' }),
      ])
      expect(serato.applyQuietly).toHaveBeenCalled()
    })
    serato.enqueue.mockClear()
    await withRun(false, async () => {
      await flush(serato)
      expect(serato.enqueue).not.toHaveBeenCalled()
    })
  })

  it('leaves the outcome of the other libraries alone when the Serato database cannot be read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-flush-serato-'))
    mkdirSync(join(dir, 'database V2'))
    const serato = {
      enqueue: vi.fn(),
      applyQuietly: vi.fn(),
      roots: () => [{ dir, root: '/' }],
    }
    await withRun(true, async () => {
      const without = await flushConversionBatch(host(), sessions, {
        rekordbox: { enqueue: vi.fn(), applyQuietly: vi.fn() },
      })
      await expect(flush(serato)).resolves.toEqual(without)
      expect(serato.enqueue).not.toHaveBeenCalled()
    })
  })

  it('does not queue a file the Serato database already holds', async () => {
    const roots = seratoHome(['m/a.flac'])
    const serato = { enqueue: vi.fn(), applyQuietly: vi.fn(), roots: () => roots }
    await withRun(true, async () => {
      await flush(serato)
      expect(serato.enqueue).not.toHaveBeenCalled()
    })
  })

  it('does not queue the output of a conversion whose source Serato holds, since Serato keeps the original and would list the track twice', async () => {
    const roots = seratoHome(['m/a.mp3'])
    const serato = { enqueue: vi.fn(), applyQuietly: vi.fn(), roots: () => roots }
    await withRun(true, async () => {
      await flush(serato)
      expect(serato.enqueue).not.toHaveBeenCalled()
    })
  })
})

describe('flushConversionBatch with a converted track Engine DJ does not have', () => {
  const engineQueue = () => ({ enqueue: vi.fn(), applyQuietly: vi.fn() })
  const flush = (engine: ReturnType<typeof engineQueue>) =>
    flushConversionBatch(host(), sessions, {
      rekordbox: { enqueue: vi.fn(), applyQuietly: vi.fn() },
      engine: engine,
    })
  async function engineLibrary(paths: string[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'surco-flush-engine-'))
    writeEngineLibraryFixture(dir, {
      tracks: paths.map((path, i) => ({ id: i + 1, path, title: `t${i}` })),
      playlists: [],
      entities: [],
    }).close()
    return dir
  }
  async function withRun(
    dir: string,
    addToEngineDj: boolean,
    run: (engine: ReturnType<typeof engineQueue>) => Promise<void>,
    syncEngineDj = false,
  ) {
    const saved = { from: REPOINTS[0].from, to: REPOINTS[0].to }
    Object.assign(REPOINTS[0], {
      from: join(dir, 'Music', 'a.mp3'),
      to: join(dir, 'Music', 'a.flac'),
      meta: { artist: 'Jaydee', title: 'Plastic Dreams' },
    })
    Object.assign(SETTINGS, { addToEngineDj, syncEngineDj, engineLibraryDir: dir })
    try {
      await run(engineQueue())
    } finally {
      Object.assign(REPOINTS[0], saved)
      delete (REPOINTS[0] as Record<string, unknown>).meta
      Object.assign(SETTINGS, { addToEngineDj: false, syncEngineDj: false, engineLibraryDir: '' })
    }
  }

  it('queues adding it to Engine DJ, so a track converted while Engine was open lands there once Engine closes', async () => {
    const dir = await engineLibrary(['Music/other.flac'])
    await withRun(dir, true, async (engine) => {
      await flush(engine)
      expect(engine.enqueue).toHaveBeenCalledWith([
        expect.objectContaining({
          kind: 'track',
          path: join(dir, 'Music', 'a.flac'),
          add: true,
          wanted: [],
        }),
      ])
      expect(engine.applyQuietly).toHaveBeenCalled()
    })
  })

  it('asks the Engine library which converted tracks it already has, so a track the conversion registered is not queued again', async () => {
    const dir = await engineLibrary(['Music/a.flac'])
    await withRun(dir, true, async (engine) => {
      await flush(engine)
      expect(engine.enqueue).not.toHaveBeenCalled()
    })
  })

  it('counts a track Engine still has under the file it was converted from, since the repoint moves that row', async () => {
    const dir = await engineLibrary(['Music/a.mp3'])
    await withRun(
      dir,
      true,
      async (engine) => {
        await flush(engine)
        expect(engine.enqueue).not.toHaveBeenCalled()
      },
      true,
    )
  })

  it('still queues adding it when Engine only has the file it was converted from and the DJ keeps Engine from following moves, since no repoint will bring that row over', async () => {
    const dir = await engineLibrary(['Music/a.mp3'])
    await withRun(dir, true, async (engine) => {
      await flush(engine)
      expect(engine.enqueue).toHaveBeenCalledWith([
        expect.objectContaining({ path: join(dir, 'Music', 'a.flac'), add: true }),
      ])
    })
  })

  it('does not read the Engine database when no converted track could be added, since a large library costs every run', async () => {
    const dir = await engineLibrary(['Music/other.flac'])
    await withRun(dir, true, async (engine) => {
      delete (REPOINTS[0] as Record<string, unknown>).meta
      READS.readFile.mockClear()
      await flush(engine)
      expect(READS.readFile).not.toHaveBeenCalledWith(join(dir, 'Database2', 'm.db'))
      expect(engine.enqueue).not.toHaveBeenCalled()
    })
  })

  it('leaves it out of Engine DJ when the DJ only updates the tracks already there', async () => {
    const dir = await engineLibrary(['Music/other.flac'])
    await withRun(dir, false, async (engine) => {
      await flush(engine)
      expect(engine.enqueue).not.toHaveBeenCalled()
    })
  })
})

// The check after the batch reads each library only when its flush wrote; one held in its
// queue waits for the apply, and one that wrote nothing has nothing to be judged.
describe('flushConversionBatch outcome', () => {
  const quiet = () => ({ enqueue: vi.fn(), applyQuietly: vi.fn() })
  const traktorQueue = () => ({
    ...quiet(),
    state: () => ({ tracks: 0, changes: 0, items: [] }),
  })

  it('flushConversionBatch says rekordbox was queued when the app is open', async () => {
    const outcome = await flushConversionBatch(host(), sessions, { rekordbox: quiet() })
    expect(outcome.rekordbox).toBe('queued')
  })

  it('says rekordbox was written once its repoint ran', async () => {
    REKORDBOX_PROCESS.isRekordboxRunning.mockResolvedValueOnce(false)
    const h = host()
    const outcome = await flushConversionBatch(h, sessions, { rekordbox: quiet() })
    expect(outcome.rekordbox).toBe('written')
  })

  it('says rekordbox failed when the collection stopped the write', async () => {
    WRITERS.repointTracks.mockResolvedValueOnce([
      { written: false, reason: 'backup-failed' },
    ] as never)
    REKORDBOX_PROCESS.isRekordboxRunning.mockResolvedValueOnce(false)
    const h = host()
    const outcome = await flushConversionBatch(h, sessions, { rekordbox: quiet() })
    expect(outcome.rekordbox).toBe('failed')
  })

  it('says rekordbox is off while its sync is', async () => {
    Object.assign(SETTINGS, { syncRekordbox: false })
    try {
      const outcome = await flushConversionBatch(host(), sessions, { rekordbox: quiet() })
      expect(outcome.rekordbox).toBe('off')
    } finally {
      Object.assign(SETTINGS, { syncRekordbox: true })
    }
  })

  it('says Engine DJ was queued while it is open and written once it is not', async () => {
    Object.assign(SETTINGS, { syncEngineDj: true, engineLibraryDir: '/e/Engine Library' })
    STATUS.engine = { enabled: true, found: true }
    try {
      ENGINE_PROCESS.isEngineDjRunning.mockResolvedValueOnce(true)
      const open = await flushConversionBatch(host(), sessions, {
        rekordbox: quiet(),
        engine: quiet(),
      })
      const closed = await flushConversionBatch(host(), sessions, {
        rekordbox: quiet(),
        engine: quiet(),
      })
      expect([open.engine, closed.engine]).toEqual(['queued', 'written'])
    } finally {
      Object.assign(SETTINGS, { syncEngineDj: false, engineLibraryDir: '' })
      STATUS.engine = { enabled: false, found: false }
    }
  })

  // Engine follows only a file that moved: a run converted in place gave it nothing.
  it('says Engine DJ is off when no converted file moved', async () => {
    Object.assign(SETTINGS, { syncEngineDj: true, engineLibraryDir: '/e/Engine Library' })
    STATUS.engine = { enabled: true, found: true }
    const to = REPOINTS[0].to
    REPOINTS[0].to = REPOINTS[0].from
    try {
      const outcome = await flushConversionBatch(host(), sessions, {
        rekordbox: quiet(),
        engine: quiet(),
      })
      expect(outcome.engine).toBe('off')
    } finally {
      REPOINTS[0].to = to
      Object.assign(SETTINGS, { syncEngineDj: false, engineLibraryDir: '' })
      STATUS.engine = { enabled: false, found: false }
    }
  })

  // A same-format reconvert that cut the lead-in keeps its path but moves the audio under
  // Engine's cues: the shift still has to reach the row, carrying the size that proves it is
  // still owed.
  it('hands Engine DJ a file rewritten in place when the audio moved under its cues', async () => {
    Object.assign(SETTINGS, { syncEngineDj: true, engineLibraryDir: '/e/Engine Library' })
    STATUS.engine = { enabled: true, found: true }
    const first = REPOINTS[0] as Record<string, unknown>
    const to = REPOINTS[0].to
    Object.assign(first, {
      to: REPOINTS[0].from,
      engineShift: { trimmedMs: 1900 },
      fromBytes: 100,
    })
    WRITERS.repointEngineTracks.mockClear()
    try {
      const outcome = await flushConversionBatch(host(), sessions, {
        rekordbox: quiet(),
        engine: quiet(),
      })
      expect(outcome.engine).toBe('written')
      expect(WRITERS.repointEngineTracks).toHaveBeenCalledWith(
        '/e/Engine Library',
        [expect.objectContaining({ to: first.from, engineShift: { trimmedMs: 1900 } })],
        expect.anything(),
      )
    } finally {
      Object.assign(first, { to, engineShift: undefined, fromBytes: undefined })
      Object.assign(SETTINGS, { syncEngineDj: false, engineLibraryDir: '' })
      STATUS.engine = { enabled: false, found: false }
    }
  })

  // A retag or a normalize in place moves no cue, but the file under Engine's row is not the
  // one it recorded the size of: the row has to learn the new size, and the check to read it.
  it('hands Engine DJ a file rewritten in place even when no cue moved', async () => {
    Object.assign(SETTINGS, { syncEngineDj: true, engineLibraryDir: '/e/Engine Library' })
    STATUS.engine = { enabled: true, found: true }
    const first = REPOINTS[0] as Record<string, unknown>
    const to = REPOINTS[0].to
    Object.assign(first, { to: REPOINTS[0].from, fromBytes: 100 })
    WRITERS.repointEngineTracks.mockClear()
    try {
      const outcome = await flushConversionBatch(host(), sessions, {
        rekordbox: quiet(),
        engine: quiet(),
      })
      expect(outcome.engine).toBe('written')
      expect(WRITERS.repointEngineTracks).toHaveBeenCalledWith(
        '/e/Engine Library',
        [expect.objectContaining({ from: first.from, to: first.from, fromBytes: 100 })],
        expect.anything(),
      )
    } finally {
      Object.assign(first, { to, fromBytes: undefined })
      Object.assign(SETTINGS, { syncEngineDj: false, engineLibraryDir: '' })
      STATUS.engine = { enabled: false, found: false }
    }
  })

  // The write keeps the row's bitrate on a file rewritten in place, and only sets it when the
  // file says what Engine would show for it now.
  it('lets Engine DJ’s write read the bitrate of the file it repoints', async () => {
    Object.assign(SETTINGS, { syncEngineDj: true, engineLibraryDir: '/e/Engine Library' })
    STATUS.engine = { enabled: true, found: true }
    WRITERS.repointEngineTracks.mockClear()
    const wav = join(await mkdtemp(join(tmpdir(), 'surco-bitrate-')), 'a.wav')
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + 4410 * 4, 4)
    header.write('WAVEfmt ', 8)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(2, 22)
    header.writeUInt32LE(44100, 24)
    header.writeUInt32LE(44100 * 4, 28)
    header.writeUInt16LE(4, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36)
    header.writeUInt32LE(4410 * 4, 40)
    await writeFile(wav, Buffer.concat([header, Buffer.alloc(4410 * 4)]))
    try {
      await flushConversionBatch(host(), sessions, { rekordbox: quiet(), engine: quiet() })
      const [[, , options]] = WRITERS.repointEngineTracks.mock.calls as unknown as [
        [
          unknown,
          unknown,
          {
            bitrateOf?: (file: string) => Promise<number | undefined>
          },
        ],
      ]
      expect(await options.bitrateOf?.(wav)).toBe(1411)
    } finally {
      Object.assign(SETTINGS, { syncEngineDj: false, engineLibraryDir: '' })
      STATUS.engine = { enabled: false, found: false }
    }
  })

  // An end nested in a batch still open takes nothing: the outer end flushes, and judges.
  it('says every library is for a later end when an outer batch is still open', async () => {
    Object.assign(SETTINGS, { syncEngineDj: true, engineLibraryDir: '/e/Engine Library' })
    STATUS.engine = { enabled: true, found: true }
    BATCH.open = true
    beginNmlBatch()
    beginNmlBatch()
    recordNmlPatch({ volume: 'HD', dir: '/:m/:', file: 'a.aiff', newFile: 'a.flac' })
    try {
      const outcome = await flushConversionBatch(host(), sessions, {
        rekordbox: quiet(),
        traktor: traktorQueue(),
        engine: quiet(),
      })
      expect([outcome.rekordbox, outcome.engine, outcome.traktor]).toEqual([
        'later',
        'later',
        'later',
      ])
    } finally {
      BATCH.open = false
      endNmlBatch()
      Object.assign(SETTINGS, { syncEngineDj: false, engineLibraryDir: '' })
      STATUS.engine = { enabled: false, found: false }
    }
  })

  describe('Traktor', () => {
    const patch = { volume: 'HD', dir: '/:m/:', file: 'a.aiff', newFile: 'a.flac' }
    let nmlPath = ''

    async function withTraktor(run: () => Promise<void>) {
      const dir = await mkdtemp(join(tmpdir(), 'surco-flush-outcome-'))
      nmlPath = join(dir, 'collection.nml')
      await writeFile(
        nmlPath,
        `<NML VERSION="19"><COLLECTION ENTRIES="1"><ENTRY TITLE="A"><LOCATION DIR="/:m/:" FILE="a.aiff" VOLUME="HD"></LOCATION></ENTRY></COLLECTION></NML>`,
      )
      Object.assign(SETTINGS, { syncTraktor: true, traktorNmlPath: nmlPath })
      STATUS.traktor = { enabled: true, found: true }
      try {
        await run()
      } finally {
        Object.assign(SETTINGS, { syncTraktor: false, traktorNmlPath: '' })
        STATUS.traktor = { enabled: false, found: false }
      }
    }

    it('hands back the entry each patch matched before the write and its cues, keyed like the queue', async () => {
      await withTraktor(async () => {
        const missing = { ...patch, file: 'b.aiff', newFile: 'b.flac' }
        beginNmlBatch()
        recordNmlPatch(patch)
        recordNmlPatch(missing)
        const outcome = await flushConversionBatch(host(), sessions, {
          rekordbox: quiet(),
          traktor: traktorQueue(),
        })
        expect(outcome.traktor).toEqual({
          before: new Map([
            [traktorPatchKey(patch), 'a.aiff'],
            [traktorPatchKey(missing), null],
          ]),
          cues: new Map([
            [traktorPatchKey(patch), ''],
            [traktorPatchKey(missing), null],
          ]),
        })
      })
    })

    it('says Traktor was queued when the DJ keeps it open', async () => {
      await withTraktor(async () => {
        beginNmlBatch()
        recordNmlPatch(patch)
        TRAKTOR_PROCESS.isTraktorRunning.mockResolvedValueOnce(true)
        const outcome = await flushConversionBatch(host(), sessions, {
          rekordbox: quiet(),
          traktor: traktorQueue(),
        })
        expect(outcome.traktor).toBe('queued')
      })
    })

    it('says Traktor failed when its collection is gone and nothing waits for it', async () => {
      await withTraktor(async () => {
        STATUS.traktor = { enabled: true, found: false }
        beginNmlBatch()
        recordNmlPatch(patch)
        const outcome = await flushConversionBatch(host(), sessions, {
          rekordbox: quiet(),
          traktor: traktorQueue(),
        })
        expect(outcome.traktor).toBe('failed')
      })
    })

    it('says Traktor is off when the run recorded nothing for it', async () => {
      await withTraktor(async () => {
        const outcome = await flushConversionBatch(host(), sessions, {
          rekordbox: quiet(),
          traktor: traktorQueue(),
        })
        expect(outcome.traktor).toBe('off')
      })
    })
  })
})

describe('flushConversionBatch order across the three programs', () => {
  it('syncs Traktor, then queues its ops, then rekordbox, then repoints and queues Engine DJ, taking the repoints once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surco-flush-order-'))
    const nmlPath = join(dir, 'collection.nml')
    await writeFile(
      nmlPath,
      `<NML VERSION="19"><COLLECTION ENTRIES="1"><ENTRY TITLE="A"><LOCATION DIR="/:m/:" FILE="a.aiff" VOLUME="HD"></LOCATION></ENTRY></COLLECTION></NML>`,
    )
    Object.assign(SETTINGS, {
      syncTraktor: true,
      traktorNmlPath: nmlPath,
      syncEngineDj: true,
      engineLibraryDir: '/e/Engine Library',
    })
    STATUS.traktor = { enabled: true, found: true }
    STATUS.engine = { enabled: true, found: true }
    Object.assign(REPOINTS[0], {
      traktorPlaylists: { wanted: [{ id: 'fri', name: 'Friday' }], base: [] },
      enginePlaylists: { wanted: [], base: ['7'] },
    })
    WRITERS.repointEngineTracks.mockImplementationOnce(async () => {
      EFFECTS.push('engine repoint')
      return [{ written: true, id: '1' }]
    })
    const recording = (label: string) => ({
      enqueue: vi.fn(() => {
        EFFECTS.push(label)
      }),
      applyQuietly: vi.fn(),
    })
    beginNmlBatch()
    recordNmlPatch({ volume: 'HD', dir: '/:m/:', file: 'a.aiff', newFile: 'a.flac' })
    EFFECTS.length = 0
    BATCH.ends = 0
    try {
      await flushConversionBatch(host(), sessions, {
        rekordbox: recording('rekordbox enqueue'),
        traktor: {
          ...recording('traktor enqueue'),
          state: () => ({ tracks: 0, changes: 0, items: [] }),
        },
        engine: recording('engine enqueue'),
      })
      expect(EFFECTS).toEqual([
        'traktor sync',
        'rekordbox take',
        'traktor enqueue',
        'rekordbox enqueue',
        'engine repoint',
        'engine enqueue',
      ])
      expect(BATCH.ends).toBe(1)
    } finally {
      WRITERS.repointEngineTracks.mockReset()
      const first = REPOINTS[0] as Record<string, unknown>
      delete first.traktorPlaylists
      delete first.enginePlaylists
      Object.assign(SETTINGS, {
        syncTraktor: false,
        traktorNmlPath: '',
        syncEngineDj: false,
        engineLibraryDir: '',
      })
      STATUS.traktor = { enabled: false, found: false }
      STATUS.engine = { enabled: false, found: false }
    }
  })
})

function recordingHost() {
  const closed: string[] = []
  const blocked: string[] = []
  const channels: string[] = []
  const libraryHost: LibraryHost = {
    ensureClosed: async (program) => {
      closed.push(program)
      return true
    },
    showBlockedDialog: (program) => {
      blocked.push(SYNC_BLOCKED_KEY[program])
    },
    reportIssue: (program) => {
      if (SYNC_ISSUE_PROGRAMS.has(program)) channels.push(program)
    },
    rekordboxHeld: () => false,
  }
  return { libraryHost, closed, blocked, channels }
}

describe('what each program closes, shows and reports through the library host', () => {
  it('closes Traktor and shows its own blocked message', async () => {
    const h = recordingHost()
    const deps = traktorFlushDeps(h.libraryHost, sessions.traktor)
    await deps.ensureTraktorClosed()
    deps.showBlockedDialog()
    expect(h.closed).toEqual(['traktor'])
    expect(h.blocked).toEqual(['traktorSyncBlocked'])
  })

  it('closes rekordbox, shows its blocked message and reports on its channel', async () => {
    const h = recordingHost()
    const deps = rekordboxFlushDeps(h.libraryHost)
    await deps.ensureClosed()
    deps.showBlockedDialog()
    deps.reportIssue({} as never)
    expect(h.closed).toEqual(['rekordbox'])
    expect(h.blocked).toEqual(['rekordboxSyncBlocked'])
    expect(h.channels).toEqual(['rekordbox'])
  })

  it('closes Engine DJ, shows its blocked message and reports on its channel', async () => {
    const h = recordingHost()
    const deps = engineFlushDeps(h.libraryHost)
    await deps.ensureClosed()
    deps.showBlockedDialog()
    deps.reportIssue({} as never)
    expect(h.closed).toEqual(['engine'])
    expect(h.blocked).toEqual(['engineSyncBlocked'])
    expect(h.channels).toEqual(['engine'])
  })
})

describe('librariesKeepingOriginal', () => {
  it('asks only the libraries Surco found but may not write to, one at a time, and names those holding the file', async () => {
    const before = { ...SETTINGS }
    Object.assign(SETTINGS, { syncRekordbox: false, syncTraktor: false })
    FILE_USE.open.mockClear()
    FILE_USE.check.mockImplementation(async () => true)
    try {
      const held = await librariesKeepingOriginal('/m/a.mp3', '/m/b.mp3', {
        traktorRead: () => '/t/collection.nml',
      })

      expect(held).toEqual(['rekordbox', 'traktor'])
      expect(FILE_USE.open).toHaveBeenCalledWith(
        { rekordbox: '/c/master.db', engine: '', traktor: '' },
        expect.anything(),
      )
      expect(FILE_USE.open).toHaveBeenCalledWith(
        { rekordbox: '', engine: '', traktor: '/t/collection.nml' },
        expect.anything(),
      )
    } finally {
      Object.assign(SETTINGS, before)
      FILE_USE.check.mockImplementation(async () => false)
    }
  })

  it('keeps the original for Traktor when its collection already has an entry under the new name, since Traktor then leaves the old entry where it was', async () => {
    const before = { ...SETTINGS }
    Object.assign(SETTINGS, { syncRekordbox: true, syncTraktor: true })
    FILE_USE.open.mockClear()
    FILE_USE.check.mockImplementation(async () => true)
    try {
      const held = await librariesKeepingOriginal('/m/a.mp3', '/m/b.mp3', {
        traktorRead: () => '/t/collection.nml',
      })

      expect(held).toEqual(['traktor'])
      expect(FILE_USE.check).toHaveBeenCalledWith('/m/a.mp3')
      expect(FILE_USE.check).toHaveBeenCalledWith('/m/b.mp3')
    } finally {
      Object.assign(SETTINGS, before)
      FILE_USE.check.mockImplementation(async () => false)
    }
  })

  it('lets a synced Traktor follow the rename when no entry holds the new name', async () => {
    const before = { ...SETTINGS }
    Object.assign(SETTINGS, { syncRekordbox: true, syncTraktor: true })
    FILE_USE.check.mockImplementation(async (path: string) => path === '/m/a.mp3')
    try {
      const held = await librariesKeepingOriginal('/m/a.mp3', '/m/b.mp3', {
        traktorRead: () => '/t/collection.nml',
      })

      expect(held).toEqual([])
    } finally {
      Object.assign(SETTINGS, before)
      FILE_USE.check.mockImplementation(async () => false)
    }
  })

  it('keeps the original for Serato, which Surco cannot point at the new file without Serato dropping the track and its rating', async () => {
    const roots = [{ dir: '/Users/dj/Music/_Serato_', root: '/' }]
    FILE_USE.open.mockClear()
    FILE_USE.check.mockImplementation(async () => true)
    try {
      const held = await librariesKeepingOriginal('/m/a.mp3', '/m/b.mp3', {
        traktorRead: () => '',
        seratoRoots: () => roots,
      })

      expect(held).toContain('serato')
      expect(FILE_USE.open).toHaveBeenCalledWith(
        { rekordbox: '', engine: '', traktor: '', serato: roots },
        expect.anything(),
      )
    } finally {
      FILE_USE.check.mockImplementation(async () => false)
    }
  })

  it('asks nothing of a library whose sync is on, since it follows the rename itself', async () => {
    FILE_USE.open.mockClear()
    const held = await librariesKeepingOriginal('/m/a.mp3', '/m/b.mp3', { traktorRead: () => '' })

    expect(held).toEqual([])
    expect(FILE_USE.open).not.toHaveBeenCalled()
  })
})
