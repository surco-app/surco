// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { MIX_IN, MIX_IN_32, normalizeCueFlows } from '../../../shared/cueFlows'
import type { DropInput } from '../../../shared/dropDetect'
import type { QueuedCues, TrackCues } from '../../../shared/types'
import { installApi } from '../test/api'
import { acceptAutoMarks, autoMarkTracks } from './cueAutoMark'
import { reduceDraft, startDraft, wantedOfDraft } from './cueDraft'
import {
  autoMarkOf,
  cueDraftKey,
  draftsToSave,
  keepDraft,
  resetCueSession,
  unsavedCueTracks,
} from './cueSession'
import { quantizePoints } from './cueWave'

const detectDrops = vi.hoisted(() => vi.fn<(input: DropInput) => number[]>())
vi.mock('../../../shared/dropDetect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/dropDetect')>()),
  detectDrops,
}))

const GRID = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
const bar = (n: number) => n * 2000
const WORDS = new Uint16Array(3000).fill((7 << 13) | (20 << 2))
const READ: TrackCues = {
  contentId: '103',
  analysed: true,
  grid: GRID,
  strong: [],
  phrases: [{ ms: bar(56), kind: 'up' }],
  cues: [],
  wave: null,
  durationMs: 400000,
  fingerprint: 'f0',
}

afterEach(resetCueSession)

beforeEach(() => {
  detectDrops.mockReset().mockReturnValue([bar(64), bar(128)])
})

function setup({
  reads = {},
  words = {},
  queued = {},
  dropInputs = {},
}: {
  reads?: Record<string, TrackCues | null>
  words?: Record<string, Uint16Array | null>
  queued?: Record<string, QueuedCues | null>
  dropInputs?: Record<string, DropInput | null>
} = {}) {
  const api = installApi({
    rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async (id) =>
      id in reads ? reads[id] : { ...READ, contentId: id },
    ),
    rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async (id) => queued[id] ?? null),
    rekordboxCueWaveDetail: vi.fn<Api['rekordboxCueWaveDetail']>(async (id) =>
      id in words ? words[id] : WORDS,
    ),
    rekordboxCueDropInput: vi.fn<Api['rekordboxCueDropInput']>(
      async (id) => dropInputs[id] ?? null,
    ),
    saveRekordboxCues: vi.fn<Api['saveRekordboxCues']>(async () => 'queued'),
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { api, client }
}

describe('Auto marcar over several tracks', () => {
  it('leaves each track its own proposals pending and accepts or writes nothing', async () => {
    detectDrops.mockReturnValueOnce([bar(64)]).mockReturnValueOnce([bar(32), bar(96)])
    const { api, client } = setup()
    await autoMarkTracks(client, ['103', '104'])
    expect(autoMarkOf('103')).toEqual({ kind: 'proposed', ms: [bar(64)] })
    expect(autoMarkOf('104')).toEqual({ kind: 'proposed', ms: [bar(32), bar(96)] })
    expect([...unsavedCueTracks()]).toEqual([])
    expect(api.saveRekordboxCues).not.toHaveBeenCalled()
  })

  it('reads each track’s grid, phrases and detailed wave, as the editor’s button does', async () => {
    const { client } = setup()
    await autoMarkTracks(client, ['103'])
    expect(detectDrops).toHaveBeenCalledWith({ grid: GRID, phrases: READ.phrases, words: WORDS })
  })

  it('says a track has no analysis when rekordbox has no grid or detailed wave for it, or cannot read it', async () => {
    const { client } = setup({
      reads: { '104': { ...READ, contentId: '104', analysed: false }, '106': null },
      words: { '105': null },
    })
    await autoMarkTracks(client, ['104', '105', '106'])
    expect(autoMarkOf('104')).toEqual({ kind: 'unanalysed' })
    expect(autoMarkOf('105')).toEqual({ kind: 'unanalysed' })
    expect(autoMarkOf('106')).toEqual({ kind: 'unanalysed' })
    expect(detectDrops).not.toHaveBeenCalled()
  })

  it('says so when the detector finds nothing', async () => {
    detectDrops.mockReturnValue([])
    const { client } = setup()
    await autoMarkTracks(client, ['103'])
    expect(autoMarkOf('103')).toEqual({ kind: 'none' })
  })

  it('leaves out breaks that already have a CALL in their bar, and says the track is marked when none is left', async () => {
    const call = (ms: number) => ({ id: `c${ms}`, ms, kind: 0, color: null })
    const { client } = setup({
      reads: {
        '103': { ...READ, cues: [call(bar(64))] },
        '104': { ...READ, contentId: '104', cues: [call(bar(64)), call(bar(128) + 500)] },
      },
    })
    await autoMarkTracks(client, ['103', '104'])
    expect(autoMarkOf('103')).toEqual({ kind: 'proposed', ms: [bar(128)] })
    expect(autoMarkOf('104')).toEqual({ kind: 'marked' })
  })

  it('counts the CALLs of an unsaved draft and of a save waiting for rekordbox, what the editor would show', async () => {
    const fresh: QueuedCues = {
      wanted: [{ ms: bar(128), kind: 0, color: null }],
      fingerprint: 'f0',
    }
    keepDraft(
      '103',
      cueDraftKey('103', 'f0', null),
      startDraft([{ ms: bar(64), kind: 0, color: null }], 'mine'),
      { path: '/m/g.wav', label: 'Gowan', fingerprint: 'f0' },
    )
    const { client } = setup({ queued: { '104': fresh } })
    await autoMarkTracks(client, ['103', '104'])
    expect(autoMarkOf('103')).toEqual({ kind: 'proposed', ms: [bar(128)] })
    expect(autoMarkOf('104')).toEqual({ kind: 'proposed', ms: [bar(64)] })
  })

  it('lets the window breathe between tracks even when everything is already read, so a long playlist never freezes it', async () => {
    const order: string[] = []
    detectDrops.mockImplementation(() => {
      order.push('detect')
      return []
    })
    const { client } = setup()
    for (const id of ['103', '104']) {
      client.setQueryData(['rekordbox-track-cues', id], { ...READ, contentId: id })
      client.setQueryData(['rekordbox-cue-wave-detail', id], WORDS)
      client.setQueryData(['rekordbox-queued-cues', id], null)
    }
    const running = autoMarkTracks(client, ['103', '104'])
    setTimeout(() => order.push('ui'), 0)
    await running
    expect(order).toEqual(['detect', 'ui', 'detect'])
  })
})

describe('accepting Auto marcar over several tracks', () => {
  const flows = normalizeCueFlows(undefined)
  const settings = (flowId: string) => ({
    cueFlows: flows,
    activeCueFlow: flowId,
    cueQuantize: 'beat' as const,
    cueLettersByTime: false,
  })
  const target = (contentId: string) => ({
    contentId,
    path: `/m/${contentId}.wav`,
    label: contentId,
  })
  const editorAccept = (flowId: string, drops: number[]) =>
    wantedOfDraft(
      reduceDraft(
        startDraft([], flowId),
        { type: 'batch', actions: drops.map((ms) => ({ type: 'mark-drop' as const, ms })) },
        {
          beats: GRID.map((b) => b.ms),
          snapTo: quantizePoints(GRID, 'beat'),
          strong: READ.strong,
          phrases: READ.phrases,
          flows,
          lettersByTime: false,
        },
      ).cues,
    )

  // The whole point of accepting from the list: thirteen tracks marked with one click instead
  // of opening each. What each track gets must be exactly what accepting its proposals in the
  // editor would give it, with the flow the DJ picked, and it stays a draft to save later.
  it('leaves every proposed track the cues the editor would place with the chosen flow, unsaved', async () => {
    detectDrops.mockReturnValueOnce([bar(64)]).mockReturnValueOnce([bar(32), bar(96)])
    const { api, client } = setup()
    await autoMarkTracks(client, ['103', '104'])

    const accepted = await acceptAutoMarks(
      client,
      [target('103'), target('104')],
      settings(MIX_IN.id),
    )

    expect(accepted).toBe(2)
    expect([...unsavedCueTracks()]).toEqual(['103', '104'])
    const saved = Object.fromEntries(draftsToSave().map((r) => [r.contentId, r]))
    expect(saved['103'].wanted).toEqual(editorAccept(MIX_IN.id, [bar(64)]))
    expect(saved['104'].wanted).toEqual(editorAccept(MIX_IN.id, [bar(32), bar(96)]))
    expect(saved['103']).toMatchObject({ path: '/m/103.wav', label: '103', fingerprint: 'f0' })
    expect(autoMarkOf('103')).toBeUndefined()
    expect(api.saveRekordboxCues).not.toHaveBeenCalled()
  })

  it('places the cues of the flow picked for the batch, not a fixed one', async () => {
    detectDrops.mockReturnValue([bar(64)])
    const { client } = setup()
    await autoMarkTracks(client, ['103'])

    await acceptAutoMarks(client, [target('103')], settings(MIX_IN_32.id))

    expect(draftsToSave()[0].wanted).toEqual(editorAccept(MIX_IN_32.id, [bar(64)]))
    expect(editorAccept(MIX_IN_32.id, [bar(64)])).not.toEqual(editorAccept(MIX_IN.id, [bar(64)]))
  })

  it('leaves alone the tracks with nothing proposed', async () => {
    const call = (ms: number) => ({ id: `c${ms}`, ms, kind: 0, color: null })
    const { client } = setup({
      reads: { '104': { ...READ, contentId: '104', cues: [call(bar(64)), call(bar(128))] } },
    })
    await autoMarkTracks(client, ['104'])

    expect(await acceptAutoMarks(client, [target('104')], settings(MIX_IN.id))).toBe(0)
    expect([...unsavedCueTracks()]).toEqual([])
    expect(autoMarkOf('104')).toEqual({ kind: 'marked' })
  })
})

describe('Auto marcar over several Engine DJ tracks', () => {
  const ENGINE_GRID = GRID.map((b) => ({ ms: b.ms + 30, beat: ((b.beat + 1) % 4) + 1 }))
  const engineRead = (id: string): TrackCues => ({
    ...READ,
    contentId: id,
    grid: ENGINE_GRID,
    phrases: [],
  })
  const REKORDBOX_INPUT: DropInput = { grid: GRID, phrases: READ.phrases, words: WORDS }

  it('detects on the structure main gives for the Engine track, not on a rekordbox wave it does not have', async () => {
    const { client, api } = setup({
      reads: { 'engine:4': engineRead('engine:4') },
      dropInputs: { 'engine:4': REKORDBOX_INPUT },
    })
    await autoMarkTracks(client, ['engine:4'])
    expect(detectDrops).toHaveBeenCalledWith(REKORDBOX_INPUT)
    expect(api.rekordboxCueWaveDetail).not.toHaveBeenCalled()
  })

  it('moves each proposal onto the nearest Engine beat, where the cue will be saved, even when Engine counts its bars from another beat', async () => {
    const { client } = setup({
      reads: { 'engine:4': engineRead('engine:4') },
      dropInputs: { 'engine:4': REKORDBOX_INPUT },
    })
    await autoMarkTracks(client, ['engine:4'])
    expect(autoMarkOf('engine:4')).toEqual({ kind: 'proposed', ms: [bar(64) + 30, bar(128) + 30] })
  })

  it('says an Engine track has no analysis when there is nothing to detect on', async () => {
    const { client } = setup({ reads: { 'engine:4': engineRead('engine:4') } })
    await autoMarkTracks(client, ['engine:4'])
    expect(autoMarkOf('engine:4')).toEqual({ kind: 'unanalysed' })
    expect(detectDrops).not.toHaveBeenCalled()
  })
})

describe('Auto marcar over a Traktor track', () => {
  it('detects on what main reads from the audio, since Traktor keeps no phrases', async () => {
    const input: DropInput = { grid: GRID, phrases: [], words: WORDS }
    const { client, api } = setup({
      reads: {
        'traktor:HD/:m/:t.wav': { ...READ, contentId: 'traktor:HD/:m/:t.wav', phrases: [] },
      },
      dropInputs: { 'traktor:HD/:m/:t.wav': input },
    })
    await autoMarkTracks(client, ['traktor:HD/:m/:t.wav'])
    expect(detectDrops).toHaveBeenCalledWith(input)
    expect(api.rekordboxCueWaveDetail).not.toHaveBeenCalled()
  })
})
