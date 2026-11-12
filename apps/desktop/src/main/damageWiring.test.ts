import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }))
vi.mock('./traktorProcess', () => ({ isTraktorRunning: vi.fn().mockResolvedValue(true) }))
vi.mock('./libraryFlushes', async (original) => ({
  ...(await original<typeof import('./libraryFlushes')>()),
  traktorFlushDeps: (host: {
    ensureClosed: (program: 'traktor') => Promise<boolean>
    showBlockedDialog: (program: 'traktor') => void
  }) => ({
    traktorNmlPath: '/t/collection.nml',
    collectionMissing: false,
    unplugged: false,
    ensureTraktorClosed: () => host.ensureClosed('traktor'),
    showBlockedDialog: () => host.showBlockedDialog('traktor'),
    syncCollection: vi.fn(),
    track: vi.fn(),
  }),
  engineFlushDeps: () => ({ collectionPath: '' }),
}))

const REWRITES = vi.hoisted(() => ({
  rewriteTagFields: vi.fn(
    async (
      file: string,
      _changes: unknown,
      _tmp: unknown,
      rewritten?: (f: string, b: number) => void,
    ) => {
      rewritten?.(file, 100)
      return { written: true }
    },
  ),
  rewriteCueTree: vi.fn(
    async (
      file: string,
      _addMs: number,
      _expected: number[],
      _tmp: unknown,
      rewritten?: (f: string, b: number) => void,
    ) => {
      rewritten?.(file, 200)
      return { written: true }
    },
  ),
}))
vi.mock('./musicFieldWrite', () => REWRITES)

import { damageDeps } from './damageWiring'
import type { LibraryHost } from './libraryFlushes'

// A damage repair with Traktor open waits in Traktor's queue and shows as pending in the
// review. Asking to quit Traktor, then calling the decline a blocked sync, turned a repair
// the review promises to hold into an error dialog.
describe('damageDeps with Traktor open', () => {
  it('neither asks to quit Traktor nor shows the blocked dialog', async () => {
    const host = {
      ensureClosed: vi.fn(async () => false),
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
    expect(host.ensureClosed).not.toHaveBeenCalled()
    expect(host.showBlockedDialog).not.toHaveBeenCalled()
  })
})

describe('damageDeps rewriting a file on its own path, whose new size VirtualDJ keeps in its song and every list row as Engine DJ keeps it in its row', () => {
  it('tells VirtualDJ of the new size, as it tells Engine DJ, for a genre and for a cue tree', async () => {
    const followEngineSize = vi.fn()
    const followVirtualdjSize = vi.fn()
    const deps = damageDeps({
      mediaAccess: { isAllowed: () => true } as never,
      tmp: { track: () => {}, untrack: () => {} },
      hostFor: () => ({}) as LibraryHost,
      sessions: { traktor: {}, engine: {}, rekordbox: {} } as never,
      beginMoment: () => {},
      backups: async () => [],
      followEngineSize,
      followVirtualdjSize,
    }).repairDeps({} as never)
    await deps.genre.rewrite('/m/a.mp3', [])
    await deps.rewriteTree?.('/m/b.mp3', 25, [])
    expect(followVirtualdjSize.mock.calls).toEqual([
      ['/m/a.mp3', 100],
      ['/m/b.mp3', 200],
    ])
    expect(followEngineSize.mock.calls).toEqual(followVirtualdjSize.mock.calls)
  })
})
