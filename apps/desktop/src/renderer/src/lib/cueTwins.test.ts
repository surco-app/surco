// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { MANUAL_CUE_FLOW, MIX_IN, MIX_IN_32, normalizeCueFlows } from '../../../shared/cueFlows'
import { ALL_SLOTS, HOT_KINDS } from '../../../shared/cueRules'
import { TRAKTOR_SLOTS } from '../../../shared/traktorContent'
import type { LibraryTracks, SurcoGrid, TrackCues } from '../../../shared/types'
import { installApi } from '../test/api'
import { type DraftContext, reduceDraft, startDraft, wantedOfDraft } from './cueDraft'
import { keepDraft, resetCueSession } from './cueSession'
import { carriedBreaks, type TwinPlan, twinPlans, twinPlansOf } from './cueTwins'
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
  gridFingerprint: '',
}
const TRAKTOR = 'traktor:M/:Music/:a.wav'
const ENGINE = 'engine:7'
const ALL: LibraryTracks = { rekordbox: '103', traktor: TRAKTOR, engine: ENGINE }
const flows = normalizeCueFlows(undefined)
const settings = (over: Partial<Record<string, boolean>> = {}) => ({
  cueFlows: flows,
  cueLettersByTime: false,
  cueFlowToRekordbox: true,
  cueFlowToTraktor: true,
  cueFlowToEngine: true,
  cueFlowToSerato: true,
  cueFlowToVirtualdj: true,
  cueLearnFromEdits: true,
  ...over,
})
const SOURCE = {
  contentId: '103',
  path: '/m/a.wav',
  label: 'a',
  breaks: [{ flowId: MIX_IN.id, points: [bar(64)] }],
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

function setup(
  twins: LibraryTracks = ALL,
  reads: Record<string, TrackCues | null> = {},
  surco: SurcoGrid | null = null,
) {
  const api = installApi({
    cues: {
      twins: vi.fn<Api['cues']['twins']>(async () => twins),
      trackCues: vi.fn<Api['cues']['trackCues']>(async (id) =>
        id in reads ? reads[id] : { ...READ, contentId: id },
      ),
      queued: vi.fn<Api['cues']['queued']>(async () => null),
      surcoGrid: vi.fn<Api['cues']['surcoGrid']>(async () => surco),
    },
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

  // Reported 29/10/2026: "of the 5 I marked, Traktor got 2 or 3 at most, or none". A DJ's
  // own Traktor collection left 2 or 3 of the seven buttons free on 23 of its 42 tracks,
  // and the hot cues that did not fit were dropped without a word, which reads as Surco
  // failing to write them. The DJ has to see how many stay out and why.
  const traktorWith = (taken: number) =>
    HOT_KINDS.slice(0, taken).map((kind, i) => ({ id: `h${i}`, ms: bar(150 + i), kind, color: 1 }))
  const FIVE = [bar(16), bar(48), bar(80), bar(112), bar(176)]
  const hotOf = (drops: number[]) =>
    wantedOfDraft(placed(drops, TRAKTOR_SLOTS).cues).filter((c) => c.kind !== 0).length

  it('counts the hot cues that find no free button in Traktor', async () => {
    const { client } = setup(ALL, {
      [TRAKTOR]: { ...READ, contentId: TRAKTOR, cues: traktorWith(5) },
    })
    const [traktor, engine] = await twinPlans(
      client,
      { ...SOURCE, breaks: [{ flowId: MIX_IN.id, points: FIVE }] },
      settings(),
    )
    expect(hotOf(FIVE)).toBe(5)
    expect(traktor.status === 'planned' && [traktor.hot, traktor.left]).toEqual([2, 3])
    expect(engine.status === 'planned' && engine.left).toBe(0)
  })

  it('reports a Traktor with every button taken instead of leaving it out', async () => {
    const { client } = setup(ALL, {
      [TRAKTOR]: { ...READ, contentId: TRAKTOR, cues: traktorWith(7) },
    })
    const plans = await twinPlans(client, SOURCE, settings())
    expect(plans.map((p) => p.contentId)).toEqual([TRAKTOR, ENGINE])
    expect(plans[0]).toEqual({
      library: 'traktor',
      contentId: TRAKTOR,
      status: 'full',
      left: hotOf([bar(64)]),
    })
  })

  // Measured on a real library: on 2 of 19 shared tracks Engine DJ counts rekordbox's beat 1
  // as beat 4. Snapping the break to Engine's nearest bar would move every cue a beat.
  it('places the flow on the same beat when the other program counts the bar from another beat', async () => {
    const shifted = GRID.map((b) => ({ ms: b.ms, beat: (b.beat % 4) + 1 }))
    const { client } = setup(ALL, { [ENGINE]: { ...READ, contentId: ENGINE, grid: shifted } })
    const plans = await twinPlans(client, SOURCE, settings())
    const engine = plans.find((p) => p.contentId === ENGINE)
    expect(engine?.status === 'planned' && engine.request.wanted.map((c) => c.ms)).toEqual(
      wantedOfDraft(placed([bar(64)]).cues).map((c) => c.ms),
    )
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
    expect(await twinPlans(client, { ...SOURCE, breaks: [] }, settings())).toEqual([])
    expect(api.cues.twins).not.toHaveBeenCalled()
  })
})

describe('placing a flow in Serato and from it', () => {
  const SERATO = 'serato:/m/a.wav'
  const SERATO_GRID = GRID.map((b) => ({ ...b, ms: b.ms + 20 }))
  const withSerato = (read: Partial<TrackCues> = {}) =>
    setup({ ...ALL, serato: SERATO }, { [SERATO]: { ...READ, contentId: SERATO, ...read } })

  it('plans the flow marked in rekordbox on the same file in Serato, on Serato’s own beats', async () => {
    const { client } = withSerato({ grid: SERATO_GRID })
    const plans = await twinPlans(client, SOURCE, settings())
    const serato = plans.find((p) => p.contentId === SERATO)
    expect(serato?.library).toBe('serato')
    const wanted = serato?.status === 'planned' ? serato.request.wanted : []
    expect(wanted.filter((c) => c.kind !== 0).map((c) => c.ms)).toEqual(
      wantedOfDraft(placed([bar(64)]).cues)
        .filter((c) => c.kind !== 0)
        .map((c) => c.ms + 20),
    )
    expect(serato?.status === 'planned' && serato.calls).toBe(0)
  })

  it('carries a flow marked in Serato to the same file in Engine DJ', async () => {
    const { client } = withSerato()
    const plans = await twinPlans(client, { ...SOURCE, contentId: SERATO }, settings())
    expect(plans.map((p) => p.library)).toEqual(['rekordbox', 'traktor', 'engine'])
    const engine = plans.find((p) => p.contentId === ENGINE)
    expect(engine?.status === 'planned' && engine.request.wanted).toEqual(
      wantedOfDraft(placed([bar(64)]).cues),
    )
  })

  it('leaves Serato out when the DJ took it out of the flows', async () => {
    const { client } = withSerato()
    const plans = await twinPlans(client, SOURCE, settings({ cueFlowToSerato: false }))
    expect(plans.map((p) => p.contentId)).toEqual([TRAKTOR, ENGINE])
  })

  it('skips a Serato track with no beat grid, as one not analysed', async () => {
    const { client } = withSerato({ analysed: false, grid: [] })
    const plans = await twinPlans(client, SOURCE, settings())
    expect(plans.map((p) => p.contentId)).toEqual([TRAKTOR, ENGINE])
  })
})

describe('placing a flow in VirtualDJ and from it', () => {
  const VDJ = 'virtualdj:/m/a.wav'
  const SERATO = 'serato:/m/a.wav'
  const VDJ_GRID = GRID.map((b) => ({ ...b, ms: b.ms + 20 }))
  const SURCO: SurcoGrid = {
    bpm: 120,
    grid: GRID.map((b) => ({ ms: b.ms + 40, beat: 0 })),
    words: null,
  }
  const unread = (contentId: string): TrackCues => ({
    ...READ,
    contentId,
    analysed: false,
    grid: [],
  })
  const hotMs = (plan: TwinPlan | undefined) =>
    plan?.status === 'planned'
      ? plan.request.wanted.filter((c) => c.kind !== 0).map((c) => c.ms)
      : []
  const flowHotMs = (shift: number) =>
    wantedOfDraft(placed([bar(64)]).cues)
      .filter((c) => c.kind !== 0)
      .map((c) => c.ms + shift)

  it('plans the flow marked in rekordbox on the same file in VirtualDJ, on VirtualDJ’s own beats, with hot cues A to H and no CALLs', async () => {
    const { client } = setup(
      { virtualdj: VDJ },
      { [VDJ]: { ...READ, contentId: VDJ, grid: VDJ_GRID } },
    )
    const plans = await twinPlans(client, SOURCE, settings())
    expect(plans.map((p) => p.library)).toEqual(['virtualdj'])
    const [vdj] = plans
    expect(vdj.status === 'planned' && vdj.request).toMatchObject({
      contentId: VDJ,
      path: '/m/a.wav',
      fingerprint: 'f0',
    })
    expect(hotMs(vdj)).toEqual(flowHotMs(20))
    expect(vdj.status === 'planned' && vdj.calls).toBe(0)
    const kinds = vdj.status === 'planned' ? vdj.request.wanted.map((c) => c.kind) : []
    expect(kinds.filter((k) => k !== 0)).toEqual(HOT_KINDS.slice(0, flowHotMs(0).length))
  })

  it('carries a flow marked in VirtualDJ to the same file in Serato', async () => {
    const { client } = setup({ virtualdj: VDJ, serato: SERATO })
    const plans = await twinPlans(client, { ...SOURCE, contentId: VDJ }, settings())
    expect(plans.map((p) => p.contentId)).toEqual([SERATO])
    expect(hotMs(plans[0])).toEqual(flowHotMs(0))
  })

  it('places the flow on Surco’s measured grid in a VirtualDJ track with no Scan', async () => {
    const { client } = setup({ virtualdj: VDJ }, { [VDJ]: unread(VDJ) }, SURCO)
    const plans = await twinPlans(client, SOURCE, settings())
    expect(plans.map((p) => p.library)).toEqual(['virtualdj'])
    expect(hotMs(plans[0])).toEqual(flowHotMs(40))
  })

  it('skips a VirtualDJ track with no Scan when Surco has no grid for it either', async () => {
    const { client } = setup({ virtualdj: VDJ }, { [VDJ]: unread(VDJ) })
    expect(await twinPlans(client, SOURCE, settings())).toEqual([])
  })

  it('still skips a track the other programs have not analysed, with Surco’s grid at hand', async () => {
    const { client } = setup(
      { rekordbox: '103', traktor: TRAKTOR, engine: ENGINE, serato: SERATO, virtualdj: VDJ },
      {
        '103': unread('103'),
        [TRAKTOR]: unread(TRAKTOR),
        [ENGINE]: unread(ENGINE),
        [SERATO]: unread(SERATO),
      },
      SURCO,
    )
    expect(await twinPlans(client, { ...SOURCE, contentId: VDJ }, settings())).toEqual([])
  })

  it('leaves VirtualDJ out when the DJ took it out of the flows', async () => {
    const { client } = setup({ virtualdj: VDJ })
    expect(await twinPlans(client, SOURCE, settings({ cueFlowToVirtualdj: false }))).toEqual([])
  })
})

describe('the breaks a flow placed in this session', () => {
  it('are the flow points of the draft that were not in the saved cues', () => {
    const saved = placed([bar(32)])
    const draft = placed([bar(64)], ALL_SLOTS, startDraft(wantedOfDraft(saved.cues), MIX_IN.id))
    expect(carriedBreaks(draft, ctx())).toEqual([{ flowId: MIX_IN.id, points: [bar(64)] }])
  })

  it('leave out CALLs placed by hand', () => {
    const draft = reduceDraft(startDraft([], MIX_IN.id), { type: 'add-call', ms: bar(64) }, ctx())
    expect(carriedBreaks(draft, ctx())).toEqual([])
  })
})

describe('placing the flows of several drafts in the other programs', () => {
  const draftOf = (contentId: string, drops: number[]) => ({
    contentId,
    path: `/m/${contentId}.wav`,
    label: contentId,
    draft: placed(drops),
  })

  // Saving from the batch or with Save all must reach the other programs too, each track
  // with the breaks its own draft marked.
  it('plans each draft’s marked breaks on its file in the other programs', async () => {
    const { api, client } = setup({ traktor: TRAKTOR })
    const plans = await twinPlansOf(client, [draftOf('103', [bar(64)])], settings())
    expect(api.cues.twins).toHaveBeenCalledWith('/m/103.wav')
    expect(plans).toEqual(
      await twinPlans(client, { ...SOURCE, path: '/m/103.wav', label: '103' }, settings()),
    )
  })

  it('never plans over a track that is itself being saved', async () => {
    const { client } = setup({ rekordbox: '103', traktor: TRAKTOR })
    const plans = await twinPlansOf(
      client,
      [draftOf('103', [bar(64)]), draftOf(TRAKTOR, [bar(32)])],
      settings(),
    )
    expect(plans).toEqual([])
  })
  it('plans a track in the other program once even when two drafts reach it', async () => {
    const { client } = setup({ traktor: TRAKTOR })
    const plans = await twinPlansOf(
      client,
      [draftOf('103', [bar(64)]), draftOf('104', [bar(96)])],
      settings(),
    )
    expect(plans.map((p) => p.contentId)).toEqual([TRAKTOR])
  })
})

describe('the flow a break travels with', () => {
  const hotMs = (plans: Awaited<ReturnType<typeof twinPlansOf>>) =>
    plans.map((p) =>
      p.status === 'planned' ? p.request.wanted.filter((c) => c.kind !== 0).map((c) => c.ms) : [],
    )

  // The DJ opens a track that was placed with one flow, switches to another and marks a
  // break: the other programs must get the cues the DJ saw placed, not the first flow's.
  it('places a break in the other programs with the flow that marked it, not the one the track was opened with', async () => {
    const { client } = setup({ traktor: TRAKTOR })
    const draft = reduceDraft(
      reduceDraft(startDraft([], MIX_IN.id), { type: 'use-flow', flowId: MIX_IN_32.id }, ctx()),
      { type: 'mark-drop', ms: bar(64) },
      ctx(),
    )
    const plans = await twinPlansOf(
      client,
      [{ contentId: '103', path: '/m/a.wav', label: 'a', draft }],
      settings(),
    )
    expect(hotMs(plans)).toEqual([[bar(56)]])
  })

  it('carries each break with its own flow when the DJ marked with two', async () => {
    const { client } = setup({ traktor: TRAKTOR })
    const first = reduceDraft(startDraft([], MIX_IN.id), { type: 'mark-drop', ms: bar(64) }, ctx())
    const draft = reduceDraft(
      reduceDraft(first, { type: 'use-flow', flowId: MIX_IN_32.id }, ctx()),
      { type: 'mark-drop', ms: bar(128) },
      ctx(),
    )
    const plans = await twinPlansOf(
      client,
      [{ contentId: '103', path: '/m/a.wav', label: 'a', draft }],
      settings(),
    )
    expect(hotMs(plans)).toEqual([[bar(48), bar(120)]])
  })

  // The list starts a Manual draft for a track nobody had opened; accepting its proposals
  // with a flow chosen must not reach the other programs as the default flow.
  it('carries the chosen flow from a draft started without one', async () => {
    const { client } = setup({ traktor: TRAKTOR })
    const draft = reduceDraft(
      reduceDraft(
        startDraft([], MANUAL_CUE_FLOW),
        { type: 'use-flow', flowId: MIX_IN_32.id },
        ctx(),
      ),
      { type: 'mark-drop', ms: bar(64) },
      ctx(),
    )
    const plans = await twinPlansOf(
      client,
      [{ contentId: '103', path: '/m/a.wav', label: 'a', draft }],
      settings(),
    )
    expect(hotMs(plans)).toEqual([[bar(56)]])
  })
})

describe('what a flow does to the cues already in the other program', () => {
  const ENGINE_ONLY: LibraryTracks = { engine: ENGINE }
  const savedDrop = { id: 'm1', ms: bar(64), kind: 0, color: null }
  const wantedThere = async (cues: TrackCues['cues'], points: number[]) => {
    const { client } = setup(ENGINE_ONLY, { [ENGINE]: { ...READ, contentId: ENGINE, cues } })
    const plans = await twinPlans(
      client,
      { ...SOURCE, breaks: [{ flowId: MIX_IN.id, points }] },
      settings(),
    )
    return plans[0]?.status === 'planned' ? plans[0].request.wanted : null
  }

  // The DJ set those cues up in that program by hand: a flow carried from another program
  // only adds what fits around them, it never takes one away or changes it.
  it('keeps a hot cue there that the new break leaves without room', async () => {
    const hand = { id: 'h1', ms: bar(48), kind: 1, color: 5 }
    const wanted = await wantedThere([savedDrop, hand], [bar(60)])
    expect(wanted).toEqual(expect.arrayContaining([savedDrop, hand]))
    expect(wanted?.some((c) => c.kind !== 0 && c.ms === bar(44))).toBe(true)
  })

  it('keeps the colour and letter of a cue there that sits where the flow would place one', async () => {
    const hand = { id: 'h1', ms: bar(48), kind: 3, color: 5 }
    const wanted = await wantedThere([savedDrop, hand], [bar(128)])
    expect(wanted).toEqual(expect.arrayContaining([savedDrop, hand]))
    const added = wanted?.filter((c) => c.kind !== 0 && c.id === undefined)
    expect(added?.map((c) => [c.ms, c.kind])).toEqual([[bar(112), 1]])
  })
})
