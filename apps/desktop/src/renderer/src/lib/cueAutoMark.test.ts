// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { DropInput } from '../../../shared/dropDetect'
import type { QueuedCues, TrackCues } from '../../../shared/types'
import { installApi } from '../test/api'
import { autoMarkTracks } from './cueAutoMark'
import { startDraft } from './cueDraft'
import { autoMarkOf, cueDraftKey, keepDraft, resetCueSession, unsavedCueTracks } from './cueSession'

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
}: {
  reads?: Record<string, TrackCues | null>
  words?: Record<string, Uint16Array | null>
  queued?: Record<string, QueuedCues | null>
} = {}) {
  const api = installApi({
    rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async (id) =>
      id in reads ? reads[id] : { ...READ, contentId: id },
    ),
    rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async (id) => queued[id] ?? null),
    rekordboxCueWaveDetail: vi.fn<Api['rekordboxCueWaveDetail']>(async (id) =>
      id in words ? words[id] : WORDS,
    ),
    saveRekordboxCues: vi.fn<Api['saveRekordboxCues']>(async () => {}),
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
