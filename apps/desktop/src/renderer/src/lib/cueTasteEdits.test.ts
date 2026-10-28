// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { DropInput } from '../../../shared/dropDetect'
import type { TrackCues } from '../../../shared/types'
import { cueDropInputQuery, cueWaveDetailQuery, trackCuesQuery } from '../hooks/useTrackCues'
import { installApi } from '../test/api'
import { startDraft } from './cueDraft'
import { recordCueEdits } from './cueTasteEdits'

const GRID = Array.from({ length: 400 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
const bar = (n: number) => n * 2000
const WORDS = new Uint16Array(150 * 200).fill((7 << 13) | (20 << 2))
const READ = {
  contentId: '103',
  analysed: true,
  grid: GRID,
  strong: [],
  phrases: [{ ms: bar(16), kind: 'chorus' }],
  cues: [],
  wave: null,
  durationMs: 200000,
  fingerprint: 'f0',
} as TrackCues

const drafted = (cues: { ms: number; kind: number }[]) =>
  startDraft(
    cues.map((c) => ({ ...c, color: c.kind === 0 ? null : 1 })),
    'mine',
  )

function setup() {
  const recordCueEdit = vi.fn<Api['recordCueEdit']>(async () => {})
  installApi({
    recordCueEdit,
    rekordboxCueWaveDetail: vi.fn<Api['rekordboxCueWaveDetail']>(async () => WORDS),
  })
  return { recordCueEdit, client: new QueryClient() }
}

describe('recordCueEdits', () => {
  it('turns a saved rekordbox track into a lesson for Auto: its candidate bars and the bars where the DJ marks', () => {
    const { client, recordCueEdit } = setup()
    client.setQueryData(trackCuesQuery('103').queryKey, READ)
    client.setQueryData(cueWaveDetailQuery('103').queryKey, WORDS)
    recordCueEdits(client, [
      {
        contentId: '103',
        draft: drafted([
          { ms: bar(16), kind: 1 },
          { ms: bar(16), kind: 0 },
          { ms: bar(32), kind: 0 },
        ]),
      },
    ])
    expect(recordCueEdit).toHaveBeenCalledTimes(1)
    const [track] = recordCueEdit.mock.calls[0]
    expect(track.key).toBe('103')
    expect(track.drops).toEqual([32])
    expect(track.candidates.length).toBeGreaterThan(0)
  })

  it('learns from an Engine or Traktor track on what Auto detected there, keeping the CALL the editor holds as the mark', () => {
    const { client, recordCueEdit } = setup()
    const input: DropInput = { grid: GRID, phrases: [], words: WORDS }
    client.setQueryData(cueDropInputQuery('engine:4').queryKey, input)
    recordCueEdits(client, [{ contentId: 'engine:4', draft: drafted([{ ms: bar(32), kind: 0 }]) }])
    expect(recordCueEdit.mock.calls[0][0]).toMatchObject({ key: 'engine:4', drops: [32] })
  })

  it('learns nothing from a save without a marked point or without the wave Auto reads, never fetching it for this', () => {
    const { client, recordCueEdit } = setup()
    client.setQueryData(trackCuesQuery('103').queryKey, READ)
    client.setQueryData(cueWaveDetailQuery('103').queryKey, WORDS)
    recordCueEdits(client, [
      { contentId: '103', draft: drafted([{ ms: bar(16), kind: 1 }]) },
      { contentId: '104', draft: drafted([{ ms: bar(32), kind: 0 }]) },
    ])
    expect(recordCueEdit).not.toHaveBeenCalled()
    expect(window.api.rekordboxCueWaveDetail).not.toHaveBeenCalled()
  })
})
