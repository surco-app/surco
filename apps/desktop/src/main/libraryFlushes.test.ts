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
vi.mock('./rekordboxQueueFromRun', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./rekordboxQueueFromRun')>()),
  trackOpsFromRun: async () => [],
}))

import { flushConversionBatch, type LibraryHost } from './libraryFlushes'

function host(overrides: Partial<LibraryHost> = {}): LibraryHost {
  return {
    ensureTraktorClosed: vi.fn(async () => true),
    ensureRekordboxClosed: vi.fn(async () => false),
    ensureEngineDjClosed: vi.fn(async () => true),
    showBlockedDialog: vi.fn(),
    reportIssue: vi.fn(),
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
