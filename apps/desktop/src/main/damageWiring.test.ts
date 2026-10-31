import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }))
vi.mock('./traktorProcess', () => ({ isTraktorRunning: vi.fn().mockResolvedValue(true) }))
vi.mock('./libraryFlushes', async (original) => ({
  ...(await original<typeof import('./libraryFlushes')>()),
  traktorFlushDeps: (host: {
    ensureTraktorClosed: () => Promise<boolean>
    showBlockedDialog: (k: string) => void
  }) => ({
    traktorNmlPath: '/t/collection.nml',
    collectionMissing: false,
    unplugged: false,
    ensureTraktorClosed: host.ensureTraktorClosed,
    showBlockedDialog: () => host.showBlockedDialog('traktorSyncBlocked'),
    syncCollection: vi.fn(),
    track: vi.fn(),
  }),
  engineFlushDeps: () => ({ collectionPath: '' }),
}))

import { damageDeps } from './damageWiring'
import type { LibraryHost } from './libraryFlushes'

// A damage repair with Traktor open waits in Traktor's queue and shows as pending in the
// review. Asking to quit Traktor, then calling the decline a blocked sync, turned a repair
// the review promises to hold into an error dialog.
describe('damageDeps with Traktor open', () => {
  it('neither asks to quit Traktor nor shows the blocked dialog', async () => {
    const host = {
      ensureTraktorClosed: vi.fn(async () => false),
      showBlockedDialog: vi.fn(),
    } as unknown as LibraryHost
    const deps = damageDeps({
      mediaAccess: { isAllowed: () => true } as never,
      tmp: { track: () => {}, untrack: () => {} },
      hostFor: () => host,
      sessions: { traktor: {}, engine: {}, rekordbox: {} } as never,
      beginMoment: () => {},
      backups: async () => [],
    }).repairDeps({} as never)
    expect(await deps.traktor?.ensureTraktorClosed()).toBe(false)
    deps.traktor?.showBlockedDialog()
    expect(host.ensureTraktorClosed).not.toHaveBeenCalled()
    expect(host.showBlockedDialog).not.toHaveBeenCalled()
  })
})
