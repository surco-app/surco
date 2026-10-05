import { describe, expect, it, vi } from 'vitest'
import type { Activity } from './activity'
import { flushEngineSync } from './engineSyncFlush'

const repoint = { from: '/m/old.mp3', to: '/m/new.aiff' }

// Runs the Activity step for real so the test sees the wording the panel would get.
function tracker() {
  const steps: { key: string; detail?: string; params?: unknown }[] = []
  const track = (async (_kind, key, run, opts) => {
    const result = await run()
    const summary = opts?.summary?.(result)
    steps.push({ key, detail: summary?.detailKey, params: summary?.detailParams })
    return result
  }) as Activity['track']
  return { steps, track }
}

describe('flushEngineSync', () => {
  // The panel has to name Engine DJ: a row worded for rekordbox would send the user to
  // check the wrong library.
  it('reports the repoint in Engine DJ wording', async () => {
    const { steps, track } = tracker()
    const result = await flushEngineSync({
      collectionPath: '/Engine Library',
      endBatch: () => [repoint],
      repointTracks: async () => [{ written: true }],
      track,
    })
    expect(result.written).toBe(1)
    expect(steps).toEqual([
      { key: 'activity.engineSync', detail: 'activity.engineSyncWritten', params: { count: 1 } },
    ])
  })

  // Engine being open is the one refusal the user can fix on the spot, so it is the one
  // that raises the dialog instead of a notice after the fact.
  it('shows the dialog when Engine DJ being open stopped the run', async () => {
    const showBlockedDialog = vi.fn()
    const reportIssue = vi.fn()
    const result = await flushEngineSync({
      collectionPath: '/Engine Library',
      endBatch: () => [repoint],
      repointTracks: async () => [{ written: false, reason: 'engine-running' }],
      showBlockedDialog,
      reportIssue,
    })
    expect(result.blocked).toBe('engine-running')
    expect(showBlockedDialog).toHaveBeenCalledOnce()
    expect(reportIssue).not.toHaveBeenCalled()
  })

  // With the toggle off the caller passes no library, and nothing may be read or written.
  it('does nothing without a library', async () => {
    const repointTracks = vi.fn()
    await flushEngineSync({ collectionPath: '', endBatch: () => [repoint], repointTracks })
    expect(repointTracks).not.toHaveBeenCalled()
  })
})
