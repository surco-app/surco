// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { QueuedCues, TrackCues } from '../../../shared/types'
import { installApi } from '../test/api'
import { startDraft } from './cueDraft'
import { forgetStaleDrafts } from './cueDrafts'
import {
  cueDraftKey,
  draftsToSave,
  keepDraft,
  resetCueSession,
  subscribeCueDrafts,
  unsavedCueTracks,
} from './cueSession'

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
  gridFingerprint: '',
}
const Q1: QueuedCues = { wanted: [{ ms: 1000, kind: 0, color: null }], fingerprint: 'f0' }
const TARGET = { path: '/m/g.wav', label: 'Gowan', fingerprint: 'f0' }

afterEach(resetCueSession)

function setup(
  queued: Record<string, QueuedCues | null>,
  fingerprint = 'f0',
  cues: TrackCues['cues'] = [],
) {
  installApi({
    cues: {
      trackCues: vi.fn<Api['cues']['trackCues']>(async (id) => ({
        ...READ,
        contentId: id,
        fingerprint,
        cues,
      })),
      queued: vi.fn<Api['cues']['queued']>(async (id) => queued[id] ?? null),
      liveCues: vi.fn<Api['cues']['liveCues']>(async (ids) =>
        Object.fromEntries(ids.map((id) => [id, { cues, fingerprint }])),
      ),
    },
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

  it('asks for the queued saves of all the drafts together and not one after another, since each answer waits behind a redraw and a save of thousands took minutes', async () => {
    const client = setup({})
    for (const id of ['103', '104', '105'])
      keepDraft(id, cueDraftKey(id, 'f0', null), startDraft([], 'mine'), TARGET)
    const answers: ((queued: null) => void)[] = []
    vi.mocked(window.api.cues.queued).mockImplementation(
      () => new Promise((resolve) => answers.push(resolve)),
    )
    const forgetting = forgetStaleDrafts(client)
    await vi.waitFor(() => expect(answers).toHaveLength(3))
    for (const answer of answers) answer(null)
    await forgetting
    expect([...unsavedCueTracks()]).toEqual(['103', '104', '105'])
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

  // The DJ saved while rekordbox was open and kept editing on top of the queued save. When
  // rekordbox closes and the queue writes exactly that save, the draft still stands on what
  // the track holds, so it is kept, now pointing at the cues rekordbox wrote.
  it('keeps a draft built on a queued save once that save is what rekordbox wrote', async () => {
    const client = setup({}, 'f1', [{ id: '77', ms: 1000, kind: 0, color: null }])
    const draft = startDraft([...Q1.wanted, { ms: 5000, kind: 0, color: null }], 'mine')
    keepDraft('103', cueDraftKey('103', 'f0', Q1), draft, TARGET, Q1)
    await forgetStaleDrafts(client)
    expect(draftsToSave()).toEqual([
      {
        contentId: '103',
        path: '/m/g.wav',
        label: 'Gowan',
        fingerprint: 'f1',
        wanted: [
          { id: '77', ms: 1000, kind: 0, color: null },
          { ms: 5000, kind: 0, color: null },
        ],
      },
    ])
  })

  it('still forgets a draft built on a queued save when rekordbox ended up with other cues', async () => {
    const client = setup({}, 'f1', [{ id: '77', ms: 9000, kind: 0, color: null }])
    keepDraft('103', cueDraftKey('103', 'f0', Q1), startDraft(Q1.wanted, 'mine'), TARGET, Q1)
    await forgetStaleDrafts(client)
    expect([...unsavedCueTracks()]).toEqual([])
  })

  it('checks many unsaved tracks through one bulk read per 500 and never reads their analysis, so Save after a big clear stays fast', async () => {
    const client = setup({})
    for (let i = 0; i < 1200; i++) {
      keepDraft(String(i), cueDraftKey(String(i), 'f0', null), startDraft([], 'mine'), TARGET)
    }
    await forgetStaleDrafts(client)
    expect(window.api.cues.liveCues).toHaveBeenCalledTimes(3)
    expect(window.api.cues.trackCues).not.toHaveBeenCalled()
    expect(unsavedCueTracks().size).toBe(1200)
  })

  it('forgets a draft whose track the bulk read did not return, as an unreadable track was forgotten before', async () => {
    const client = setup({})
    vi.mocked(window.api.cues.liveCues).mockResolvedValue({})
    keepDraft('103', cueDraftKey('103', 'f0', null), startDraft([], 'mine'), TARGET)
    await forgetStaleDrafts(client)
    expect([...unsavedCueTracks()]).toEqual([])
  })

  it('notifies the draft listeners once when it forgets many stale drafts, so the batch view does not rebuild per track', async () => {
    const client = setup({}, 'f1')
    for (let i = 0; i < 50; i++) {
      keepDraft(String(i), cueDraftKey(String(i), 'f0', null), startDraft([], 'mine'), TARGET)
    }
    const listener = vi.fn()
    const off = subscribeCueDrafts(listener)
    await forgetStaleDrafts(client)
    off()
    expect(unsavedCueTracks().size).toBe(0)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("keeps the drafts of a chunk whose read failed, so a busy database during a queue write never discards the DJ's work", async () => {
    const client = setup({})
    for (let i = 0; i < 600; i++) {
      keepDraft(String(i), cueDraftKey(String(i), 'f0', null), startDraft([], 'mine'), TARGET)
    }
    vi.mocked(window.api.cues.liveCues)
      .mockRejectedValueOnce(new Error('database busy'))
      .mockImplementation(async (ids) =>
        Object.fromEntries(ids.map((id) => [id, { cues: [], fingerprint: 'f1' }])),
      )
    await forgetStaleDrafts(client)
    expect([...unsavedCueTracks()]).toEqual(Array.from({ length: 500 }, (_, i) => String(i)))
  })
})
