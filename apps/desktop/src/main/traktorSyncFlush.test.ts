import { describe, expect, it, vi } from 'vitest'
import type { ActivityEvent } from '../shared/types'
import { createActivity } from './activity'
import type { NmlPatch } from './traktorNml'
import type { SyncResult } from './traktorNmlLibrary'
import { type FlushTraktorSyncDeps, flushTraktorSync } from './traktorSyncFlush'

function patch(overrides: Partial<NmlPatch> = {}): NmlPatch {
  return { volume: 'Macintosh HD', dir: '/:Users:me:Music:', file: 'a.wav', ...overrides }
}

function makeDeps(overrides: Partial<FlushTraktorSyncDeps> = {}): FlushTraktorSyncDeps {
  return {
    traktorNmlPath: '/Users/me/collection.nml',
    endNmlBatch: vi.fn(() => [patch()]),
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
  it('says the collection is missing when the toggle is on but the file is gone', async () => {
    let summaryDetail: unknown
    const deps = makeDeps({
      traktorNmlPath: '',
      collectionMissing: true,
      track: vi.fn(async (_kind, _labelKey, task, opts) => {
        const result = await task()
        summaryDetail = opts?.summary?.(result)
        return result
      }),
    })
    await flushTraktorSync(deps)

    expect(summaryDetail).toEqual({ detailKey: 'activity.traktorSyncCollectionMissing' })
    expect(deps.ensureTraktorClosed).not.toHaveBeenCalled()
    expect(deps.syncCollection).not.toHaveBeenCalled()
  })

  it('does nothing when no collection.nml path is configured', async () => {
    const deps = makeDeps({ traktorNmlPath: '' })
    await flushTraktorSync(deps)

    // endNmlBatch still has to run: it closes this call's begin/end pair regardless of
    // whether there's anywhere to sync to, or depth would never return to zero and every
    // later batch would stay "nested" and never flush (see nmlBatch.ts).
    expect(deps.endNmlBatch).toHaveBeenCalledOnce()
    expect(deps.ensureTraktorClosed).not.toHaveBeenCalled()
    expect(deps.syncCollection).not.toHaveBeenCalled()
  })

  it('does nothing when no patches were recorded', async () => {
    const deps = makeDeps({ endNmlBatch: vi.fn(() => []) })
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

  // rekordbox and Engine DJ leave a row when the user keeps them open; Traktor said it
  // only in a dialog, so Activity showed nothing for a library that got nothing.
  it('leaves a warning row in Activity when the user keeps Traktor open', async () => {
    const activity = createActivity()
    const events: ActivityEvent[] = []
    activity.subscribe((e) => events.push(e))
    await flushTraktorSync(
      makeDeps({ ensureTraktorClosed: vi.fn(async () => false), track: activity.track }),
    )
    expect(events.map((e) => [e.phase, e.labelKey, e.detailKey])).toEqual([
      ['start', 'activity.traktorSync', undefined],
      ['warn', 'activity.traktorSync', 'activity.traktorSyncTraktorRunning'],
    ])
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

  // What the review's done sheet shows on Traktor's row.
  describe('the outcome it returns', () => {
    it.each([
      ['updated with the matched count', {}, { outcome: 'updated', count: 1 }],
      [
        'nothing when no patch was recorded',
        { endNmlBatch: vi.fn(() => []) },
        { outcome: 'nothing' },
      ],
      ['nothing when Traktor sync is off', { traktorNmlPath: '' }, { outcome: 'nothing' }],
      [
        'missing when collection.nml is gone',
        { traktorNmlPath: '', collectionMissing: true },
        { outcome: 'missing' },
      ],
      [
        'open when the user kept Traktor open',
        { ensureTraktorClosed: vi.fn(async () => false) },
        { outcome: 'open' },
      ],
      [
        'open when Traktor opened before the write',
        {
          syncCollection: vi.fn(
            async () => ({ written: false, matched: 0, reason: 'traktor-running' }) as SyncResult,
          ),
        },
        { outcome: 'open' },
      ],
      [
        'nothing when no track matched',
        {
          syncCollection: vi.fn(
            async () => ({ written: false, matched: 0, reason: 'no-matches' }) as SyncResult,
          ),
        },
        { outcome: 'nothing' },
      ],
      [
        'failed when the write failed',
        {
          syncCollection: vi.fn(
            async () => ({ written: false, matched: 0, reason: 'write-failed' }) as SyncResult,
          ),
        },
        { outcome: 'failed' },
      ],
    ] as const)('is %s', async (_name, over, expected) => {
      await expect(flushTraktorSync(makeDeps(over))).resolves.toEqual(expected)
    })
  })
})
