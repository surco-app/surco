// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { MIX_IN, normalizeCueFlows } from '../../../shared/cueFlows'
import { ALL_SLOTS, HOT_KINDS } from '../../../shared/cueRules'
import { TRAKTOR_SLOTS } from '../../../shared/traktorContent'
import type { LibraryTracks, TrackCues } from '../../../shared/types'
import { installApi } from '../test/api'
import { type DraftContext, reduceDraft, startDraft, wantedOfDraft } from './cueDraft'
import { keepDraft, resetCueSession } from './cueSession'
import { carriedPoints, twinPlans } from './cueTwins'
import { quantizePoints } from './cueWave'

const GRID = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
const bar = (n: number) => n * 2000
const READ: TrackCues = {
  contentId: '103',
  analysed: true,
  grid: GRID,
  strong: [],
  phrases: [],
  cues: [],
  wave: null,
  durationMs: 400000,
  fingerprint: 'f0',
}
const TRAKTOR = 'traktor:M/:Music/:a.wav'
const ENGINE = 'engine:7'
const ALL: LibraryTracks = { rekordbox: '103', traktor: TRAKTOR, engine: ENGINE }
const flows = normalizeCueFlows(undefined)
const settings = (over: Partial<Record<string, boolean>> = {}) => ({
  cueFlows: flows,
  cueQuantize: 'beat' as const,
  cueLettersByTime: false,
  cueFlowToRekordbox: true,
  cueFlowToTraktor: true,
  cueFlowToEngine: true,
  ...over,
})
const SOURCE = {
  contentId: '103',
  path: '/m/a.wav',
  label: 'a',
  flowId: MIX_IN.id,
  points: [bar(64)],
}

const ctx = (slots = ALL_SLOTS): DraftContext => ({
  beats: GRID.map((b) => b.ms),
  snapTo: quantizePoints(GRID, 'beat'),
  strong: [],
  phrases: [],
  flows,
  lettersByTime: false,
  slots,
})
const placed = (drops: number[], slots = ALL_SLOTS, start = startDraft([], MIX_IN.id)) =>
  reduceDraft(
    start,
    { type: 'batch', actions: drops.map((ms) => ({ type: 'mark-drop' as const, ms })) },
    ctx(slots),
  )

afterEach(resetCueSession)

function setup(twins: LibraryTracks = ALL, reads: Record<string, TrackCues | null> = {}) {
  const api = installApi({
    rekordboxCueTwins: vi.fn<Api['rekordboxCueTwins']>(async () => twins),
    rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async (id) =>
      id in reads ? reads[id] : { ...READ, contentId: id },
    ),
    rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => null),
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { api, client }
}

describe('placing a flow in the other DJ programs', () => {
  // The DJ marks a break once and every program they play from gets the same flow on it,
  // each with its own letters: Traktor keeps button 1 for its AutoGrid, so it has A to G.
  it('plans the flow on the same file in every other program, as that program places it', async () => {
    const { client } = setup()
    const plans = await twinPlans(client, SOURCE, settings())
    expect(plans.map((p) => p.contentId)).toEqual([TRAKTOR, ENGINE])
    const [traktor, engine] = plans
    expect(traktor.status === 'planned' && traktor.request).toEqual({
      contentId: TRAKTOR,
      path: '/m/a.wav',
      label: 'a',
      fingerprint: 'f0',
      wanted: wantedOfDraft(placed([bar(64)], TRAKTOR_SLOTS).cues),
    })
    expect(engine.status === 'planned' && engine.request.wanted).toEqual(
      wantedOfDraft(placed([bar(64)]).cues),
    )
  })

  it('counts what the flow adds there, with CALLs only where the program has them', async () => {
    const { client } = setup()
    const plans = await twinPlans(client, { ...SOURCE, contentId: TRAKTOR }, settings())
    const added = wantedOfDraft(placed([bar(64)]).cues)
    const hot = added.filter((c) => c.kind !== 0).length
    expect(plans.map((p) => p.status === 'planned' && [p.library, p.hot, p.calls])).toEqual([
      ['rekordbox', hot, added.length - hot],
      ['engine', hot, 0],
    ])
  })

  it('fits the flow in the seven buttons Traktor leaves to Surco', async () => {
    const full = HOT_KINDS.slice(0, 7).map((kind, i) => ({
      id: `h${i}`,
      ms: bar(150 + i),
      kind,
      color: 1,
    }))
    const { client } = setup(ALL, { [TRAKTOR]: { ...READ, contentId: TRAKTOR, cues: full } })
    const plans = await twinPlans(client, SOURCE, settings())
    expect(plans.map((p) => p.contentId)).toEqual([ENGINE])
  })

  it('leaves out a program the DJ took out of the flows', async () => {
    const { client } = setup()
    const plans = await twinPlans(client, SOURCE, settings({ cueFlowToEngine: false }))
    expect(plans.map((p) => p.contentId)).toEqual([TRAKTOR])
  })

  // Unsaved work in the other program is the DJ's: the flow never overwrites it unasked.
  it('keeps a track with unsaved changes in the other program untouched, unless the DJ says to', async () => {
    const { client } = setup()
    keepDraft(ENGINE, 'k', placed([bar(32)]), { path: '/m/a.wav', label: 'a', fingerprint: 'f0' })
    const plans = await twinPlans(client, SOURCE, settings())
    expect(plans.find((p) => p.contentId === ENGINE)).toEqual({
      library: 'engine',
      contentId: ENGINE,
      status: 'unsaved',
    })
    const forced = await twinPlans(client, SOURCE, settings(), new Set([ENGINE]))
    const engine = forced.find((p) => p.contentId === ENGINE)
    expect(engine?.status === 'planned' && engine.request.wanted).toEqual(
      wantedOfDraft(placed([bar(64)]).cues),
    )
  })

  it('says nothing about a program that already has the flow there or has not analysed the track', async () => {
    const { client } = setup(ALL, {
      [TRAKTOR]: {
        ...READ,
        contentId: TRAKTOR,
        cues: wantedOfDraft(placed([bar(64)], TRAKTOR_SLOTS).cues).map((c, i) => ({
          ...c,
          id: `t${i}`,
        })),
      },
      [ENGINE]: { ...READ, contentId: ENGINE, analysed: false },
    })
    expect(await twinPlans(client, SOURCE, settings())).toEqual([])
  })

  it('asks nothing when no break was marked with a flow', async () => {
    const { api, client } = setup()
    expect(await twinPlans(client, { ...SOURCE, points: [] }, settings())).toEqual([])
    expect(api.rekordboxCueTwins).not.toHaveBeenCalled()
  })
})

describe('the breaks a flow placed in this session', () => {
  it('are the flow points of the draft that were not in the saved cues', () => {
    const saved = placed([bar(32)])
    const draft = placed([bar(64)], ALL_SLOTS, startDraft(wantedOfDraft(saved.cues), MIX_IN.id))
    expect(carriedPoints(draft, ctx())).toEqual([bar(64)])
  })

  it('leave out CALLs placed by hand', () => {
    const draft = reduceDraft(startDraft([], MIX_IN.id), { type: 'add-call', ms: bar(64) }, ctx())
    expect(carriedPoints(draft, ctx())).toEqual([])
  })
})
