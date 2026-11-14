// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { QueuedCues, TrackCues } from '../../../shared/types'
import { installApi } from '../test/api'
import { phraseCountsOf } from './phraseCountBatch'

const grid = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
const calls = (...beats: number[]) =>
  beats.map((b) => ({ id: `c${b}`, ms: b * 500, kind: 0, color: null }))

function read(contentId: string, cues: TrackCues['cues'], analysed = true): TrackCues {
  return {
    contentId,
    analysed,
    grid,
    strong: [],
    phrases: [],
    cues,
    wave: null,
    durationMs: 400000,
    fingerprint: 'f',
    gridFingerprint: 'g',
  }
}

function setup(reads: Record<string, TrackCues | null>, queued: Record<string, QueuedCues> = {}) {
  const api = installApi({
    cues: {
      trackCues: vi.fn<Api['cues']['trackCues']>(async (id) => reads[id] ?? null),
      queued: vi.fn<Api['cues']['queued']>(async (id) => queued[id] ?? null),
    },
  })
  return { api, client: new QueryClient() }
}

describe('phraseCountsOf', () => {
  it('counts every selected track that has two CALLs and leaves out the rest, so those comments stay untouched', async () => {
    const { client } = setup({
      '1': read('1', calls(0, 64, 320)),
      '2': read('2', calls(0)),
      '3': read('3', calls(0, 64), false),
      '4': null,
    })
    const counts = await phraseCountsOf(client, [
      { id: 'a', contentId: '1' },
      { id: 'b', contentId: '2' },
      { id: 'c', contentId: '3' },
      { id: 'd', contentId: '4' },
    ])
    expect([...counts]).toEqual([['a', '2 - 8']])
  })

  it('counts the CALLs waiting in the queue, because those are what rekordbox will get', async () => {
    const { client } = setup(
      { '1': read('1', calls(0, 64)) },
      { '1': { wanted: calls(0, 128), fingerprint: 'f' } },
    )
    const counts = await phraseCountsOf(client, [{ id: 'a', contentId: '1' }])
    expect(counts.get('a')).toBe('4')
  })

  it('skips a track rekordbox cannot read and goes on with the rest, so one moved file does not stop the playlist', async () => {
    const { api, client } = setup({ '2': read('2', calls(0, 64)) })
    vi.mocked(api.cues.trackCues).mockRejectedValueOnce(new Error('ENOENT'))
    vi.mocked(api.cues.queued).mockRejectedValueOnce(new Error('locked'))
    const counts = await phraseCountsOf(client, [
      { id: 'a', contentId: '1' },
      { id: 'b', contentId: '2' },
    ])
    expect([...counts]).toEqual([['b', '2']])
  })

  it('reuses a track already open in the cue editor without asking rekordbox again', async () => {
    const { api, client } = setup({})
    client.setQueryData(['rekordbox-track-cues', '1'], read('1', calls(0, 32)))
    client.setQueryData(['rekordbox-queued-cues', '1'], null)
    const counts = await phraseCountsOf(client, [{ id: 'a', contentId: '1' }])
    expect(counts.get('a')).toBe('1')
    expect(api.cues.trackCues).not.toHaveBeenCalled()
  })

  it('keeps what it reads out of the cache, since a playlist of thousands would hold every waveform in memory', async () => {
    const { client } = setup({ '1': read('1', calls(0, 64)) })
    await phraseCountsOf(client, [{ id: 'a', contentId: '1' }])
    expect(client.getQueryData(['rekordbox-track-cues', '1'])).toBeUndefined()
  })
})
