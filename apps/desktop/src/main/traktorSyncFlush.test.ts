import { describe, expect, it, vi } from 'vitest'
import type { NmlPatch } from './traktorNml'
import type { SyncResult } from './traktorNmlLibrary'
import { type FlushTraktorSyncDeps, flushTraktorSync } from './traktorSyncFlush'

function patch(overrides: Partial<NmlPatch> = {}): NmlPatch {
  return { volume: 'Macintosh HD', dir: '/:Users:me:Music:', file: 'a.wav', ...overrides }
}

function makeDeps(overrides: Partial<FlushTraktorSyncDeps> = {}): FlushTraktorSyncDeps {
  return {
    traktorNmlPath: '/Users/me/collection.nml',
    takeNmlPatches: vi.fn(() => [patch()]),
    ensureTraktorClosed: vi.fn(async () => true),
    showBlockedDialog: vi.fn(),
    syncCollection: vi.fn(async () => ({ written: true, matched: 1 }) as SyncResult),
    track: vi.fn((_kind, _labelKey, task) => task()),
    ...overrides,
  }
}

// The process:batch-end flow, lifted out of the IPC handler so these branches have a
// test at all — before this file, every one of them was verified only by reading the
// handler. Each guards a case where getting it wrong either drops the user's collection
// update silently or writes it when it shouldn't have (Traktor still open).
describe('flushTraktorSync', () => {
  it('does nothing when no collection.nml path is configured', async () => {
    const deps = makeDeps({ traktorNmlPath: '' })
    await flushTraktorSync(deps)

    expect(deps.takeNmlPatches).not.toHaveBeenCalled()
    expect(deps.ensureTraktorClosed).not.toHaveBeenCalled()
    expect(deps.syncCollection).not.toHaveBeenCalled()
  })

  it('does nothing when no patches were recorded', async () => {
    const deps = makeDeps({ takeNmlPatches: vi.fn(() => []) })
    await flushTraktorSync(deps)

    expect(deps.ensureTraktorClosed).not.toHaveBeenCalled()
    expect(deps.syncCollection).not.toHaveBeenCalled()
  })

  it('warns and never writes when the user declines to close Traktor', async () => {
    const deps = makeDeps({ ensureTraktorClosed: vi.fn(async () => false) })
    await flushTraktorSync(deps)

    expect(deps.showBlockedDialog).toHaveBeenCalledOnce()
    expect(deps.syncCollection).not.toHaveBeenCalled()
  })

  it('writes the collection once Traktor is confirmed closed', async () => {
    const syncCollection = vi.fn(async () => ({ written: true, matched: 3 }) as SyncResult)
    const deps = makeDeps({ syncCollection })
    await flushTraktorSync(deps)

    expect(syncCollection).toHaveBeenCalledWith('/Users/me/collection.nml', [patch()])
    expect(deps.showBlockedDialog).not.toHaveBeenCalled()
  })

  // The reason -> detail key mapping the activity row reads: every syncCollection skip
  // reason must resolve to its own line, not fall through to a neighbor's.
  it.each([
    ['backup-failed', 'activity.traktorSyncBackupFailed'],
    ['no-matches', 'activity.traktorSyncNoMatches'],
    ['unreadable', 'activity.traktorSyncUnreadable'],
    ['write-failed', 'activity.traktorSyncWriteFailed'],
    ['traktor-running', 'activity.traktorSyncTraktorRunning'],
  ] as const)('maps skip reason %s to %s', async (reason, detailKey) => {
    let summaryDetail: unknown
    const deps = makeDeps({
      syncCollection: vi.fn(async () => ({ written: false, matched: 0, reason }) as SyncResult),
      track: vi.fn(async (_kind, _labelKey, task, opts) => {
        const result = await task()
        summaryDetail = opts?.summary?.(result)
        return result
      }),
    })
    await flushTraktorSync(deps)

    expect(summaryDetail).toEqual({ detailKey })
  })

  it('reports a written sync with its matched count', async () => {
    let summaryDetail: unknown
    const deps = makeDeps({
      syncCollection: vi.fn(async () => ({ written: true, matched: 5 }) as SyncResult),
      track: vi.fn(async (_kind, _labelKey, task, opts) => {
        const result = await task()
        summaryDetail = opts?.summary?.(result)
        return result
      }),
    })
    await flushTraktorSync(deps)

    expect(summaryDetail).toEqual({
      detailKey: 'activity.traktorSyncWritten',
      detailParams: { count: 5 },
    })
  })

  // Unreachable today (every written:false branch in syncCollection sets a reason) but
  // pinned so a fallback like `reason ?? 'unreadable'` — which would misreport an
  // unrelated cause — can never creep back in.
  it('never fabricates a reason when written is false with none set', async () => {
    let summaryDetail: unknown
    const deps = makeDeps({
      syncCollection: vi.fn(
        async () => ({ written: false, matched: 0, reason: undefined }) as SyncResult,
      ),
      track: vi.fn(async (_kind, _labelKey, task, opts) => {
        const result = await task()
        summaryDetail = opts?.summary?.(result)
        return result
      }),
    })
    await flushTraktorSync(deps)

    expect(summaryDetail).not.toEqual({ detailKey: 'activity.traktorSyncUnreadable' })
  })
})
