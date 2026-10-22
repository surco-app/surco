// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { QueuedCues, TrackCues } from '../../../shared/types'
import { installApi } from '../test/api'
import { startDraft } from './cueDraft'
import { forgetStaleDrafts } from './cueDrafts'
import { cueDraftKey, keepDraft, resetCueSession, unsavedCueTracks } from './cueSession'

const READ: TrackCues = {
  contentId: '103',
  analysed: true,
  grid: [{ ms: 0, beat: 1 }],
  strong: [],
  phrases: [],
  cues: [],
  wave: null,
  durationMs: 400000,
  fingerprint: 'f0',
}
const Q1: QueuedCues = { wanted: [{ ms: 1000, kind: 0, color: null }], fingerprint: 'f0' }
const TARGET = { path: '/m/g.wav', label: 'Gowan', fingerprint: 'f0' }

afterEach(resetCueSession)

function setup(queued: Record<string, QueuedCues | null>, fingerprint = 'f0') {
  installApi({
    rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async (id) => ({
      ...READ,
      contentId: id,
      fingerprint,
    })),
    rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async (id) => queued[id] ?? null),
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['rekordbox-queued-cues', '103'], Q1)
  return client
}

describe('forgetting stale cue drafts', () => {
  it('forgets a draft built on a queued save that was discarded since, so saving it never brings those cues back', async () => {
    const client = setup({})
    keepDraft('103', cueDraftKey('103', 'f0', Q1), startDraft([], 'mine'), TARGET)
    await forgetStaleDrafts(client)
    expect([...unsavedCueTracks()]).toEqual([])
  })

  it('forgets a draft built on a read rekordbox has changed since', async () => {
    const client = setup({ '103': Q1 }, 'f1')
    keepDraft('103', cueDraftKey('103', 'f0', Q1), startDraft([], 'mine'), TARGET)
    await forgetStaleDrafts(client)
    expect([...unsavedCueTracks()]).toEqual([])
  })

  it('keeps a draft still built on what rekordbox and the queue hold, the rule the editor reopens it by', async () => {
    const client = setup({ '103': Q1 })
    keepDraft('103', cueDraftKey('103', 'f0', Q1), startDraft([], 'mine'), TARGET)
    keepDraft('104', cueDraftKey('104', 'f0', null), startDraft([], 'mine'), TARGET)
    await forgetStaleDrafts(client)
    expect([...unsavedCueTracks()]).toEqual(['103', '104'])
  })
})
