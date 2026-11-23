// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { DropInput, DropTaste, TasteTrack } from '../../../shared/autoCue'
import type { CueProfileRead } from '../../../shared/cueProfile'
import type { TrackCues } from '../../../shared/types'
import {
  cueDropInputQuery,
  cueProfileQuery,
  cueWaveDetailQuery,
  trackCuesQuery,
} from '../hooks/useTrackCues'
import { installApi } from '../test/api'
import { startDraft } from './cueDraft'
import { recordCueEdits } from './cueTasteEdits'

const tasteTrackOf = vi.hoisted(() =>
  vi.fn(
    (_input: DropInput, drops: number[], _proposedWith?: { taste: DropTaste | null }) =>
      ({ key: 'lesson', candidates: [], drops }) as TasteTrack | null,
  ),
)
vi.mock('../../../shared/autoCue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/autoCue')>()
  return { ...actual, autoCue: { ...actual.autoCue, tasteTrackOf } }
})

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
  gridFingerprint: '',
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
    cues: {
      waveDetail: vi.fn<Api['cues']['waveDetail']>(async () => WORDS),
    },
  })
  tasteTrackOf.mockClear()
  return { recordCueEdit, client: new QueryClient() }
}

describe('recordCueEdits', () => {
  it('hands Auto a saved rekordbox track with its grid, phrases and wave, and only the points the DJ marks', async () => {
    const { client, recordCueEdit } = setup()
    client.setQueryData(trackCuesQuery('103').queryKey, READ)
    client.setQueryData(cueWaveDetailQuery('103').queryKey, WORDS)
    await recordCueEdits(client, [
      {
        contentId: '103',
        draft: drafted([
          { ms: bar(16), kind: 1 },
          { ms: bar(16), kind: 0 },
          { ms: bar(32), kind: 0 },
        ]),
      },
    ])
    expect(tasteTrackOf).toHaveBeenCalledTimes(1)
    expect(tasteTrackOf).toHaveBeenCalledWith(
      { grid: GRID, phrases: READ.phrases, words: WORDS },
      [bar(32)],
      { taste: null },
    )
    expect(recordCueEdit).toHaveBeenCalledWith({ key: 'lesson', candidates: [], drops: [bar(32)] })
  })

  it('learns from an Engine or Traktor track on what Auto detected there, keeping the CALL the editor holds as the mark', async () => {
    const { client, recordCueEdit } = setup()
    const input: DropInput = { grid: GRID, phrases: [], words: WORDS }
    client.setQueryData(cueDropInputQuery('engine:4').queryKey, input)
    await recordCueEdits(client, [
      { contentId: 'engine:4', draft: drafted([{ ms: bar(32), kind: 0 }]) },
    ])
    expect(tasteTrackOf).toHaveBeenCalledWith(input, [bar(32)], { taste: null })
    expect(recordCueEdit.mock.calls[0][0]).toMatchObject({ drops: [bar(32)] })
  })

  it('learns nothing from a save without a marked point, and reads nothing for it', async () => {
    const { client, recordCueEdit } = setup()
    await recordCueEdits(client, [{ contentId: '103', draft: drafted([{ ms: bar(16), kind: 1 }]) }])
    expect(recordCueEdit).not.toHaveBeenCalled()
    expect(window.api.cues.waveDetail).not.toHaveBeenCalled()
  })

  it('reads the wave again when the window let it go, so a track edited a while ago still teaches Auto when it is saved', async () => {
    const { client, recordCueEdit } = setup()
    client.setQueryData(trackCuesQuery('103').queryKey, READ)
    await recordCueEdits(client, [{ contentId: '103', draft: drafted([{ ms: bar(32), kind: 0 }]) }])
    expect(window.api.cues.waveDetail).toHaveBeenCalledWith('103')
    expect(tasteTrackOf.mock.calls[0][0].words).toEqual(WORDS)
    expect(recordCueEdit.mock.calls[0][0]).toMatchObject({ drops: [bar(32)] })
  })

  it('learns nothing from a track whose wave cannot be read, and the save goes on', async () => {
    const { client, recordCueEdit } = setup()
    vi.mocked(window.api.cues.waveDetail).mockRejectedValue(new Error('gone'))
    client.setQueryData(trackCuesQuery('103').queryKey, READ)
    await recordCueEdits(client, [{ contentId: '103', draft: drafted([{ ms: bar(32), kind: 0 }]) }])
    expect(recordCueEdit).not.toHaveBeenCalled()
  })

  it('tells Auto the taste it proposed with, so the lesson can say whether the DJ accepted or corrected it', async () => {
    const { client } = setup()
    const taste: DropTaste = {
      trees: [[[0.5]]],
      picking: { threshold: 0, spacingBars: 16, maxDrops: 2 },
    }
    client.setQueryData<CueProfileRead>(cueProfileQuery.queryKey, {
      profile: {
        learnedAt: '2026-11-01T00:00:00.000Z',
        sources: { rekordbox: 40, edits: 0 },
        taste,
        check: null,
        flow: null,
        coverage: null,
        paired: null,
        start: null,
      },
      edits: { count: 0, sinceLearn: 0, corrected: 0 },
      marked: 0,
    })
    client.setQueryData(cueDropInputQuery('engine:4').queryKey, {
      grid: GRID,
      phrases: [],
      words: WORDS,
    })
    await recordCueEdits(client, [
      { contentId: 'engine:4', draft: drafted([{ ms: bar(32), kind: 0 }]) },
    ])
    expect(tasteTrackOf.mock.calls[0][2]).toEqual({ taste })
  })

  it('records nothing when the engine makes no lesson of the track, as the basic engine never does', async () => {
    const { client, recordCueEdit } = setup()
    tasteTrackOf.mockReturnValueOnce(null)
    client.setQueryData(cueDropInputQuery('engine:4').queryKey, {
      grid: GRID,
      phrases: [],
      words: WORDS,
    })
    await recordCueEdits(client, [
      { contentId: 'engine:4', draft: drafted([{ ms: bar(32), kind: 0 }]) },
    ])
    expect(tasteTrackOf).toHaveBeenCalledTimes(1)
    expect(recordCueEdit).not.toHaveBeenCalled()
  })
})
