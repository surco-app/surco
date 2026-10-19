import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const SETTINGS = vi.hoisted(() => ({
  syncRekordbox: true,
  rekordboxDbPath: '/c/master.db',
  syncEngineDj: false,
  engineLibraryDir: '',
  syncTraktor: false,
  traktorNmlPath: '',
}))
const REPOINTS = vi.hoisted(() => [
  { from: '/m/a.mp3', to: '/m/a.flac', playlists: [{ name: 'House' }] },
])

vi.mock('./settings', () => ({ getSettings: () => SETTINGS }))
vi.mock('./rekordboxPath', () => ({ findRekordboxCollection: () => '/c/master.db' }))
vi.mock('./libraryStatus', () => ({
  libraryStatus: () => ({
    rekordbox: { enabled: true, found: true },
    engine: { enabled: false, found: false },
    traktor: { enabled: false, found: false },
  }),
}))
vi.mock('./rekordboxBatch', () => ({ endRekordboxBatch: () => REPOINTS }))
const WRITERS = vi.hoisted(() => ({
  trackOpsFromRun: vi.fn(async () => []),
  repointTracks: vi.fn(async () => [{ written: true }]),
  updateRekordboxTags: vi.fn(async () => [{ written: true }]),
  replaceRekordboxDuplicates: vi.fn(async () => [{ written: true, outcome: 'replaced' }]),
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

import {
  duplicateLibraryDeps,
  flushConversionBatch,
  type LibraryHost,
  syncTagsInLibraries,
} from './libraryFlushes'

function host(overrides: Partial<LibraryHost> = {}): LibraryHost {
  return {
    ensureTraktorClosed: vi.fn(async () => true),
    ensureRekordboxClosed: vi.fn(async () => false),
    ensureEngineDjClosed: vi.fn(async () => true),
    showBlockedDialog: vi.fn(),
    reportIssue: vi.fn(),
    rekordboxHeld: () => false,
    ...overrides,
  }
}

const sessions = {
  rekordbox: { ensure: vi.fn(async () => {}), reset: vi.fn() },
  engine: { ensure: vi.fn(async () => {}), reset: vi.fn() },
}

describe('flushConversionBatch with rekordbox open', () => {
  it('queues the run instead of showing the blocked dialog, because the queue applies it later', async () => {
    const h = host()
    const queue = { enqueue: vi.fn(), applyQuietly: vi.fn() }
    await flushConversionBatch(h, sessions, queue)
    expect(h.showBlockedDialog).not.toHaveBeenCalled()
    expect(queue.enqueue).toHaveBeenCalledWith([], REPOINTS)
    expect(queue.applyQuietly).toHaveBeenCalled()
  })
})

describe('rekordbox writes while the queue is held after a write left the collection unknown', () => {
  const held = () =>
    host({ ensureRekordboxClosed: vi.fn(async () => true), rekordboxHeld: () => true })

  it('keeps the conversion run in the queue instead of repointing, so master.db.surco-backup stays the good copy', async () => {
    WRITERS.repointTracks.mockClear()
    const queue = { enqueue: vi.fn(), applyQuietly: vi.fn() }
    await flushConversionBatch(held(), sessions, queue)
    expect(WRITERS.repointTracks).not.toHaveBeenCalled()
    expect(queue.enqueue).toHaveBeenCalledWith([], REPOINTS)
  })

  it('reads the run playlists by where each track came from, because its repoint waits in the queue', async () => {
    WRITERS.trackOpsFromRun.mockClear()
    await flushConversionBatch(held(), sessions, { enqueue: vi.fn(), applyQuietly: vi.fn() })
    expect(WRITERS.trackOpsFromRun).toHaveBeenCalledWith(
      '/c/master.db',
      REPOINTS,
      expect.objectContaining({ repointing: true }),
    )
  })

  it('does not write Update tags into the collection, so master.db.surco-backup stays the good copy', async () => {
    WRITERS.updateRekordboxTags.mockClear()
    await syncTagsInLibraries([{ path: '/m/a.flac', fields: {} }], held(), sessions)
    expect(WRITERS.updateRekordboxTags).not.toHaveBeenCalled()
  })

  it('still writes Update tags when the queue is not held', async () => {
    WRITERS.updateRekordboxTags.mockClear()
    await syncTagsInLibraries(
      [{ path: '/m/a.flac', fields: {} }],
      host({ ensureRekordboxClosed: vi.fn(async () => true) }),
      sessions,
    )
    expect(WRITERS.updateRekordboxTags).toHaveBeenCalled()
  })

  it('hands the duplicate writer the hold, and keeps rekordbox in the step so the removed copy is not trashed', async () => {
    WRITERS.replaceRekordboxDuplicates.mockClear()
    const deps = duplicateLibraryDeps(held(), sessions)
    await deps.libraries.rekordbox?.([{ from: '/m/a.mp3', to: '/m/b.mp3' }])
    const [, , options] = WRITERS.replaceRekordboxDuplicates.mock.calls[0] as unknown as [
      string,
      unknown,
      { held: () => boolean },
    ]
    expect(options.held()).toBe(true)
  })
})
