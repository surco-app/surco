import { describe, expect, it } from 'vitest'
import { CALLS_ONLY, type CueFlow, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import { type ExistingCue, validWantedSet } from '../../../shared/cueRules'
import {
  type CueDraft,
  type DraftAction,
  type DraftCue,
  draftDrops,
  draftPoints,
  freeLetters,
  ghostOf,
  reduceDraft,
  startDraft,
  wantedOfDraft,
} from './cueDraft'
import { quantizePoints } from './cueWave'

const beats = Array.from({ length: 800 }, (_, i) => i * 500)
const bar = (n: number) => n * 2000
const KEPT: CueFlow[] = [MY_FLOW, ONE_AT_32, CALLS_ONLY]
const ctx = { beats, snapTo: beats, strong: [], phrases: [], flows: KEPT }
const run = (state: CueDraft, ...actions: DraftAction[]) =>
  actions.reduce((s, a) => reduceDraft(s, a, ctx), state)
const empty = () => startDraft([], 'mine')
const at = (s: CueDraft, ms: number, hot: boolean) =>
  s.cues.find((c) => c.ms === ms && (c.kind !== 0) === hot)

describe('reduceDraft', () => {
  it('marks a drop on the nearest beat and lets the flow draw the countdown', () => {
    const s = run(empty(), { type: 'mark-drop', ms: bar(64) + 120 })
    expect(draftDrops(s.cues)).toEqual([bar(64)])
    expect(s.cues.filter((c) => c.kind !== 0).map((c) => [c.ms, c.kind, c.color])).toEqual([
      [bar(16), 1, 42],
      [bar(32), 2, 22],
      [bar(48), 3, 1],
    ])
  })

  it('draws with the bundled flow when the flow of the draft was deleted, since that is the flow Surco falls back to', () => {
    const s = reduceDraft(startDraft([], 'gone'), { type: 'mark-drop', ms: bar(80) }, ctx)
    expect(s.cues.filter((c) => c.kind !== 0).map((c) => [c.ms, c.color])).toEqual([[bar(16), 22]])
  })

  it('keeps one drop when the same position is marked twice', () => {
    const s = run(
      empty(),
      { type: 'mark-drop', ms: bar(64) },
      { type: 'mark-drop', ms: bar(64) + 10 },
    )
    expect(draftDrops(s.cues)).toEqual([bar(64)])
  })

  it('marking a drop after moving a countdown cue keeps the move and only adds the CALL', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const a = at(marked, bar(16), true)
    const moved = run(marked, { type: 'move', key: a?.key as string, ms: bar(20) })
    const s = run(moved, { type: 'mark-drop', ms: bar(128) })
    expect(s.notice).toBe('manual')
    expect(at(s, bar(20), true)).toBeDefined()
    expect(draftDrops(s.cues)).toEqual([bar(64), bar(128)])
    expect(s.cues.filter((c) => c.kind !== 0)).toHaveLength(3)
  })

  it('marks a drop on a countdown cue and keeps that CALL as the drop', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const s = run(marked, { type: 'mark-drop', ms: bar(48) })
    expect(s).not.toBe(marked)
    expect(draftDrops(s.cues)).toContain(bar(48))
    expect(at(s, bar(48), false)).toBeDefined()
  })

  it('moves a hot cue with the CALL under it, snapped to the beat, and keeps its letter', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const b = at(marked, bar(32), true)
    const s = run(marked, { type: 'move', key: b?.key as string, ms: bar(36) + 200 })
    expect(at(s, bar(36), true)).toMatchObject({ kind: 2, color: 22 })
    expect(at(s, bar(36), false)).toBeDefined()
    expect(at(s, bar(32), false)).toBeUndefined()
  })

  it('keeps a hot cue the DJ moved, recoloured or relettered when the next drop regenerates the flow', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const a = at(marked, bar(16), true)?.key as string
    const b = at(marked, bar(32), true)?.key as string
    const c = at(marked, bar(48), true)?.key as string
    const edited = run(
      marked,
      { type: 'move', key: a, ms: bar(0) },
      { type: 'recolour', key: b, color: 5 },
      { type: 'reletter', key: c, kind: 7 },
    )
    const s = run(edited, { type: 'mark-drop', ms: bar(128) })
    expect(s.cues.find((x) => x.key === a)).toMatchObject({ ms: bar(0), kind: 1, color: 42 })
    expect(s.cues.find((x) => x.key === b)).toMatchObject({ ms: bar(32), kind: 2, color: 5 })
    expect(s.cues.find((x) => x.key === c)).toMatchObject({ ms: bar(48), kind: 7, color: 1 })
    const hot = s.cues.filter((x) => x.kind !== 0)
    expect(new Set(hot.map((x) => x.kind)).size).toBe(hot.length)
    expect(validWantedSet(wantedOfDraft(s.cues), [])).toEqual({ ok: true })
    const applied = run(edited, { type: 'apply-flow', flowId: 'mine' })
    expect(applied.cues.find((x) => x.key === b)).toMatchObject({ kind: 2, color: 5 })
    expect(applied.cues.find((x) => x.key === c)).toMatchObject({ kind: 7 })
  })

  it('clears every hot cue and CALL but the loops in one undoable step, leaving a valid set', () => {
    const live = [
      { id: 'l', ms: bar(16), kind: 1, color: 1 },
      { id: 'm', ms: bar(80), kind: 0, color: null },
    ]
    const marked = run(
      startDraft(live, 'mine', ['l', 'm']),
      { type: 'mark-drop', ms: bar(64) },
      { type: 'add-hot', ms: bar(20) },
      { type: 'add-call', ms: bar(24) },
    )
    const cleared = run(marked, { type: 'clear' })
    expect(cleared.cues.map((c) => c.key).sort()).toEqual(['l', 'm'])
    expect(cleared.edited).toEqual([])
    expect(cleared.placed).toEqual([])
    expect(
      validWantedSet(
        wantedOfDraft(cleared.cues),
        live.map((c) => ({ ...c, loop: true })),
      ),
    ).toEqual({
      ok: true,
    })
    const undone = run(cleared, { type: 'undo' })
    expect(undone.cues).toEqual(marked.cues)
    expect(undone.edited).toEqual(marked.edited)
    expect(undone.placed).toEqual(marked.placed)
  })

  it('has nothing to clear when only loops remain, so no undo step is recorded', () => {
    const s = startDraft([{ id: 'l', ms: bar(16), kind: 1, color: 1 }], 'mine', ['l'])
    expect(run(s, { type: 'clear' })).toBe(s)
  })

  it('leaves a loop as rekordbox holds it, whatever the DJ or the flow tries', () => {
    const live = [
      { id: 'l', ms: bar(16), kind: 1, color: 1 },
      { id: 'm', ms: bar(80), kind: 0, color: null },
    ]
    const s = startDraft(live, 'mine', ['l', 'm'])
    for (const a of [
      { type: 'move', key: 'l', ms: bar(20) },
      { type: 'remove', key: 'l' },
      { type: 'recolour', key: 'l', color: 5 },
      { type: 'reletter', key: 'l', kind: 9 },
      { type: 'move', key: 'm', ms: bar(84) },
      { type: 'remove', key: 'm' },
    ] as DraftAction[])
      expect(run(s, a)).toBe(s)
    const marked = run(
      s,
      { type: 'mark-drop', ms: bar(64) },
      { type: 'apply-flow', flowId: 'one-at-32' },
    )
    expect(marked.cues.find((c) => c.key === 'l')).toMatchObject({ ms: bar(16), kind: 1, color: 1 })
    expect(marked.cues.find((c) => c.key === 'm')).toMatchObject({ ms: bar(80), kind: 0 })
  })

  it('never reads a memory loop as a drop, so no flow counts down to it', () => {
    const s = startDraft([{ id: 'm', ms: bar(100), kind: 0, color: null }], 'mine', ['m'])
    expect(draftDrops(s.cues, s.locked)).toEqual([])
    const marked = run(s, { type: 'mark-drop', ms: bar(64) })
    expect(draftDrops(marked.cues, marked.locked)).toEqual([bar(64)])
    expect(marked.cues.filter((c) => c.kind !== 0).map((c) => c.ms)).toEqual([
      bar(16),
      bar(32),
      bar(48),
    ])
    expect(marked.cues.find((c) => c.key === 'm')).toMatchObject({ ms: bar(100), kind: 0 })
  })

  it('refuses a move onto another hot cue so two never share a spot', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const a = at(marked, bar(16), true)
    expect(run(marked, { type: 'move', key: a?.key as string, ms: bar(32) })).toBe(marked)
  })

  it('deletes a hot cue with its CALL, so the CALL never reads as a drop', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const c = at(marked, bar(48), true)
    const s = run(marked, { type: 'remove', key: c?.key as string })
    expect(at(s, bar(48), true)).toBeUndefined()
    expect(at(s, bar(48), false)).toBeUndefined()
    expect(draftDrops(s.cues)).toEqual([bar(64)])
  })

  it('deletes a CALL under a hot cue and leaves the hot cue', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const call = at(marked, bar(48), false)
    const s = run(marked, { type: 'remove', key: call?.key as string })
    expect(at(s, bar(48), true)).toBeDefined()
    expect(at(s, bar(48), false)).toBeUndefined()
  })

  it('recolours and reletters hot cues only, and only to a free letter', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const a = at(marked, bar(16), true)?.key as string
    const call = at(marked, bar(16), false)?.key as string
    const s = run(
      marked,
      { type: 'recolour', key: a, color: 5 },
      { type: 'reletter', key: a, kind: 2 },
      { type: 'reletter', key: a, kind: 9 },
      { type: 'recolour', key: call, color: 5 },
    )
    expect(at(s, bar(16), true)).toMatchObject({ kind: 9, color: 5 })
    expect(at(s, bar(16), false)?.color).toBeNull()
    expect(freeLetters(s.cues)).toEqual([1, 5, 6, 7, 8])
  })

  it('adds a hot cue on the first free letter in the default colour, never a ninth', () => {
    let s = run(empty(), { type: 'add-hot', ms: bar(10) })
    expect(at(s, bar(10), true)).toMatchObject({ kind: 1, color: 22 })
    for (let i = 1; i < 8; i++) s = run(s, { type: 'add-hot', ms: bar(10 + 4 * i) })
    expect(run(s, { type: 'add-hot', ms: bar(100) })).toBe(s)
  })

  it('puts a hot cue on the letter the DJ pressed, on the beat under the playhead, in the default colour', () => {
    const s = run(empty(), { type: 'add-hot', ms: bar(10) + 120, kind: 5 })
    const d = at(s, bar(10), true)
    expect(d).toMatchObject({ kind: 5, color: 22 })
    expect(s.selected).toBe(d?.key)
  })

  it('never puts a second cue on a letter in use, nor a letter rekordbox has no pad for', () => {
    const placed = run(empty(), { type: 'add-hot', ms: bar(10), kind: 1 })
    expect(run(placed, { type: 'add-hot', ms: bar(20), kind: 1 })).toBe(placed)
    expect(run(placed, { type: 'add-hot', ms: bar(20), kind: 4 })).toBe(placed)
    expect(run(placed, { type: 'add-hot', ms: bar(20), kind: 10 })).toBe(placed)
  })

  it('keeps every set main accepts when the pads place cues by letter', () => {
    let s = startDraft([], 'mine')
    for (const kind of [9, 1, 5, 2]) {
      s = reduceDraft(s, { type: 'add-hot', ms: bar(8 * kind), kind }, ctx)
      expect(validWantedSet(wantedOfDraft(s.cues), [])).toEqual({ ok: true })
    }
    expect(s.cues.map((c) => c.kind).sort()).toEqual([1, 2, 5, 9])
  })

  it('keeps a hot cue the DJ placed by letter when the next drop or flow regenerates the plan', () => {
    const placed = run(empty(), { type: 'add-hot', ms: bar(48), kind: 5 })
    const own = at(placed, bar(48), true)?.key as string
    const marked = run(placed, { type: 'mark-drop', ms: bar(64) })
    expect(marked.cues.find((x) => x.key === own)).toMatchObject({
      ms: bar(48),
      kind: 5,
      color: 22,
    })
    const applied = run(marked, { type: 'apply-flow', flowId: 'mine' })
    expect(applied.cues.find((x) => x.key === own)).toMatchObject({
      ms: bar(48),
      kind: 5,
      color: 22,
    })
    const hot = marked.cues.filter((x) => x.kind !== 0)
    expect(new Set(hot.map((x) => x.kind)).size).toBe(hot.length)
    expect(validWantedSet(wantedOfDraft(marked.cues), [])).toEqual({ ok: true })
  })

  it('keeps a valid set when a letter placed by the DJ meets a loop holding another letter', () => {
    const live = [{ id: 'l', ms: bar(16), kind: 2, color: 1 }]
    let s = startDraft(live, 'mine', ['l'])
    s = run(s, { type: 'add-hot', ms: bar(100), kind: 2 })
    expect(s.cues).toHaveLength(1)
    s = run(s, { type: 'add-hot', ms: bar(100), kind: 3 }, { type: 'mark-drop', ms: bar(64) })
    expect(validWantedSet(wantedOfDraft(s.cues), [])).toEqual({ ok: true })
    expect(s.cues.find((c) => c.key === 'l')).toMatchObject({ kind: 2 })
  })

  it('adds a CALL without asking the flow for anything', () => {
    const s = run(empty(), { type: 'add-call', ms: bar(64) })
    expect(s.cues.map((c) => [c.ms, c.kind])).toEqual([[bar(64), 0]])
  })

  it('applies another flow to the drops already marked, replacing what the first flow drew', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const s = run(marked, { type: 'apply-flow', flowId: 'one-at-32' })
    expect(s.flowId).toBe('one-at-32')
    expect(s.cues.filter((c) => c.kind !== 0).map((c) => [c.ms, c.kind, c.color])).toEqual([
      [bar(32), 1, 22],
    ])
    expect(draftDrops(s.cues)).toEqual([bar(64)])
  })

  it('applies another flow as placing it afresh on the same points would, taking away the CALLs the first flow paired with its hot cues', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const action: DraftAction = { type: 'apply-flow', flowId: 'one-at-32' }
    const applied = run(marked, action)
    const fresh = run(startDraft([], 'one-at-32'), { type: 'mark-drop', ms: bar(64) })
    const marksOf = (s: CueDraft) => s.cues.map((c) => `${c.ms} ${c.kind} ${c.color}`).sort()
    expect(marksOf(applied)).toEqual(marksOf(fresh))
    expect(ghostOf(marked, action, ctx).gone).toContain(at(marked, bar(32), false)?.key)
  })

  it('keeps the CALL under a hot cue when the applied flow pairs a CALL there too', () => {
    const paired: CueFlow = {
      ...ONE_AT_32,
      id: 'paired',
      rules: [{ ...ONE_AT_32.rules[0], place: 'both' }],
    }
    const withPaired = { ...ctx, flows: [...KEPT, paired] }
    const marked = reduceDraft(empty(), { type: 'mark-drop', ms: bar(64) }, withPaired)
    const applied = reduceDraft(marked, { type: 'apply-flow', flowId: 'paired' }, withPaired)
    expect(at(applied, bar(32), false)?.key).toBe(at(marked, bar(32), false)?.key)
  })

  it('keeps a CALL the DJ put by hand on a hot cue when another flow is applied', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const own = run(
      marked,
      { type: 'remove', key: at(marked, bar(32), false)?.key as string },
      { type: 'add-call', ms: bar(32) },
    )
    const applied = run(own, { type: 'apply-flow', flowId: 'one-at-32' })
    expect(at(applied, bar(32), false)?.key).toBe(at(own, bar(32), false)?.key)
  })

  it('switches to a flow chosen in Settings without touching the draft, and places the next point with it alone', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const switched = run(marked, { type: 'use-flow', flowId: 'one-at-32' })
    expect(switched.cues).toBe(marked.cues)
    expect(switched.past).toBe(marked.past)
    const s = run(switched, { type: 'mark-drop', ms: bar(160) })
    expect(s.notice).toBeNull()
    expect(s.flowId).toBe('one-at-32')
    expect(s.cues.filter((c) => c.kind !== 0).map((c) => [c.ms, c.color])).toEqual([
      [bar(16), 42],
      [bar(32), 22],
      [bar(48), 1],
      [bar(128), 22],
    ])
  })

  it('places a point with a flow picked but not applied without touching the points already marked, so only Aplicar a esta pista changes them', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const switched = run(marked, { type: 'use-flow', flowId: 'one-at-32' })
    const action: DraftAction = { type: 'mark-drop', ms: bar(160) }
    const s = run(switched, action)
    expect(s.cues).toEqual(expect.arrayContaining(marked.cues))
    const added = s.cues.filter((c) => !marked.cues.includes(c))
    expect(added.map((c) => [c.ms, c.kind !== 0, c.color]).sort()).toEqual(
      [
        [bar(128), true, 22],
        [bar(160), false, null],
      ].sort(),
    )
    const g = ghostOf(switched, action, ctx)
    expect(g.gone).toEqual([])
    expect(g.added).toEqual(added)
    expect(
      ghostOf(s, { type: 'apply-flow', flowId: 'one-at-32' }, ctx).gone.length,
    ).toBeGreaterThan(0)
    expect(validWantedSet(wantedOfDraft(s.cues), [])).toEqual({ ok: true })
    expect(run(s, { type: 'undo' }).cues).toEqual(marked.cues)
  })

  it('says a plan needs more than 8 hot cues and changes nothing', () => {
    let s = startDraft([{ id: 'y', ms: 500, kind: 1, color: 32 }], 'mine')
    for (const n of [48, 96, 144]) s = run(s, { type: 'mark-drop', ms: bar(n) })
    const before = s.cues
    const after = run(s, { type: 'mark-drop', ms: bar(192) })
    expect(after.notice).toBe('too-many')
    expect(after.cues).toBe(before)
  })

  it('undoes one step at a time and never undoes a selection', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const selected = run(marked, { type: 'select', key: marked.cues[0].key })
    const removed = run(selected, { type: 'remove', key: marked.cues[0].key })
    expect(run(removed, { type: 'undo' }).cues).toEqual(marked.cues)
    expect(run(removed, { type: 'undo' }, { type: 'undo' }).cues).toEqual([])
  })

  it('keeps the rekordbox ID of a cue it moves, so the save is a move and not a new cue', () => {
    const s = startDraft(
      [
        { id: '70001', ms: bar(16), kind: 1, color: 1 },
        { id: '70002', ms: bar(16), kind: 0, color: null },
      ],
      'mine',
    )
    const moved = run(s, { type: 'move', key: '70001', ms: bar(20) })
    expect(moved.cues.map((c) => [c.id, c.ms])).toEqual([
      ['70001', bar(20)],
      ['70002', bar(20)],
    ])
  })

  it('undoes a flow change with its flow and trimmed cues, so the next mark uses the first flow again', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const switched = run(marked, { type: 'apply-flow', flowId: 'one-at-32' })
    const back = run(switched, { type: 'undo' })
    expect(back.flowId).toBe('mine')
    expect(back.trimmed).toEqual(marked.trimmed)
    const again = run(back, { type: 'mark-drop', ms: bar(128) })
    expect(again.notice).toBeNull()
    expect(again.flowId).toBe('mine')
  })

  it('clears the trimmed cues once a manual edit makes them stale', () => {
    let s = startDraft([{ id: 'y', ms: 500, kind: 1, color: 32 }], 'mine')
    for (const n of [48, 96]) s = run(s, { type: 'mark-drop', ms: bar(n) })
    s = { ...s, trimmed: [bar(1)] }
    expect(run(s, { type: 'add-call', ms: bar(7) }).trimmed).toEqual([])
  })

  it('refuses to move an unpaired hot cue onto a drop', () => {
    const s = run(empty(), { type: 'add-call', ms: bar(64) }, { type: 'add-hot', ms: bar(10) })
    const hot = at(s, bar(10), true)
    expect(run(s, { type: 'move', key: hot?.key as string, ms: bar(64) })).toBe(s)
  })

  it('does nothing that needs a beat when the track has no grid', () => {
    const bare = { ...ctx, beats: [] as number[] }
    const s = empty()
    for (const a of [
      { type: 'mark-drop', ms: 1000 },
      { type: 'add-hot', ms: 1000 },
      { type: 'add-call', ms: 1000 },
    ] as DraftAction[])
      expect(reduceDraft(s, a, bare)).toBe(s)
  })

  it('never hands main a set it refuses, whatever the editing sequence', () => {
    const live: ExistingCue[] = [
      { id: '1', ms: bar(16), kind: 1, color: 0 as unknown as number },
      { id: '2', ms: bar(16), kind: 0, color: null },
      { id: '3', ms: bar(30), kind: 10, color: 5 },
      { id: '4', ms: bar(64), kind: 0, color: null },
    ]
    let s = startDraft(live, 'mine')
    const check = () => expect(validWantedSet(wantedOfDraft(s.cues), live)).toEqual({ ok: true })
    const step = (a: DraftAction) => {
      s = reduceDraft(s, a, ctx)
      check()
    }
    check()
    step({ type: 'mark-drop', ms: bar(100) })
    step({ type: 'move', key: '1', ms: bar(20) })
    step({ type: 'reletter', key: '1', kind: 2 })
    step({ type: 'recolour', key: '1', color: 9 })
    step({ type: 'add-hot', ms: bar(12) })
    step({ type: 'add-call', ms: bar(13) })
    step({ type: 'remove', key: '2' })
    step({ type: 'apply-flow', flowId: 'one-at-32' })
    step({ type: 'mark-drop', ms: bar(140) })
    step({ type: 'undo' })
  })

  it('drops the editor keys and keeps every other field of a cue', () => {
    const s = startDraft([{ id: '7', ms: 10, kind: 1, color: 4 }], 'mine')
    expect(wantedOfDraft(s.cues)).toEqual([{ id: '7', ms: 10, kind: 1, color: 4 }])
  })
})

const QUIET: CueFlow = { ...ONE_AT_32, id: 'quiet', markPoint: false }
const MIXED: CueFlow = {
  id: 'mixed',
  name: '',
  markPoint: false,
  rules: [ONE_AT_32.rules[0], { ...MY_FLOW.rules[1], when: 'always' }],
}
const CHORUS: CueFlow = {
  id: 'chorus',
  name: '',
  markPoint: false,
  rules: [
    {
      from: 'chorus',
      direction: 'back',
      bars: 0,
      repeat: 1,
      when: 'always',
      place: 'hot',
      color: { fixed: 5 },
    },
  ],
}
const BOTH: CueFlow = { ...MY_FLOW, id: 'qb', markPoint: false }
const MANY: CueFlow = {
  id: 'many',
  name: '',
  markPoint: false,
  rules: Array.from({ length: 9 }, (_, i) => ({
    ...ONE_AT_32.rules[0],
    bars: 4 * (i + 1),
    when: 'always' as const,
  })),
}
const wide = {
  ...ctx,
  flows: [...KEPT, QUIET, MIXED, CHORUS, BOTH, MANY],
  phrases: [
    { ms: bar(64), kind: 'chorus' as const },
    { ms: bar(128), kind: 'chorus' as const },
  ],
}
const runWide = (state: CueDraft, ...actions: DraftAction[]) =>
  actions.reduce((s, a) => reduceDraft(s, a, wide), state)
const hotOf = (s: { cues: DraftCue[] }) =>
  s.cues
    .filter((c) => c.kind !== 0)
    .sort((a, b) => a.ms - b.ms)
    .map((c) => [c.ms, c.kind, c.color])
const shape = (cues: DraftCue[]) => cues.map((c) => `${c.key} ${c.ms} ${c.kind} ${c.color}`).sort()
const throughGhost = (s: CueDraft, a: DraftAction) => {
  const g = ghostOf(s, a, wide)
  return [...s.cues.filter((c) => !g.gone.includes(c.key)), ...g.added]
}

describe('a flow that leaves the point unmarked', () => {
  it('places the cues of the point with no CALL on it, so nothing reads as a point afterwards', () => {
    const s = runWide(startDraft([], 'quiet'), { type: 'mark-drop', ms: bar(64) + 120 })
    expect(hotOf(s)).toEqual([[bar(32), 1, 22]])
    expect(s.cues.filter((c) => c.kind === 0)).toEqual([])
    expect(draftDrops(s.cues)).toEqual([])
  })

  it('places again after a placement that left no CALL, so a DJ who does not mark the point can place on every part of the track', () => {
    const s = runWide(
      startDraft([], 'quiet'),
      { type: 'mark-drop', ms: bar(64) },
      { type: 'mark-drop', ms: bar(160) },
    )
    expect(hotOf(s)).toEqual([
      [bar(32), 1, 22],
      [bar(128), 2, 22],
    ])
    expect(s.notice).toBeNull()
    expect(s.cues.filter((c) => c.kind === 0)).toEqual([])
    expect(draftDrops(s.cues)).toEqual([])
  })

  it('places the cues of a mixed flow that do not depend on the point too, in time order of letters', () => {
    const s = runWide(startDraft([], 'mixed'), { type: 'mark-drop', ms: bar(64) })
    expect(hotOf(s)).toEqual([
      [0, 1, 32],
      [bar(32), 2, 22],
    ])
    expect(s.cues.filter((c) => c.kind === 0).map((c) => c.ms)).toEqual([0])
  })

  it('skips a spot already taken and keeps what is there, as a cue placed by hand would', () => {
    const s = runWide(startDraft([{ id: 'h', ms: bar(32), kind: 5, color: 1 }], 'quiet'), {
      type: 'mark-drop',
      ms: bar(64),
    })
    expect(s.cues).toHaveLength(1)
    expect(s.past).toHaveLength(0)
  })

  it('leaves out the CALL of a hot cue it skips, so the hand-placed hot cue does not gain a CALL nobody asked for', () => {
    const s = runWide(startDraft([{ id: 'h', ms: bar(32), kind: 5, color: 1 }], 'qb'), {
      type: 'mark-drop',
      ms: bar(64),
    })
    expect(s.cues.some((c) => c.kind === 0 && c.ms === bar(32))).toBe(false)
    expect(s.cues.some((c) => c.kind === 0 && c.ms === bar(16))).toBe(true)
  })

  it('counts the placed hot cues as edited, so applying a flow later keeps them like any cue placed by hand', () => {
    const s = runWide(startDraft([], 'mixed'), { type: 'mark-drop', ms: bar(64) })
    expect([...s.edited].sort()).toEqual(
      s.cues
        .filter((c) => c.kind !== 0)
        .map((c) => c.key)
        .sort(),
    )
    expect(s.edited).toHaveLength(2)
  })

  it('warns and changes nothing when the free letters cannot hold the placement', () => {
    const start = startDraft(
      [1, 2, 3, 5, 6, 7, 8].map((kind, i) => ({
        id: `h${kind}`,
        ms: bar(200 + 8 * i),
        kind,
        color: 1,
      })),
      'qb',
    )
    const s = runWide(start, { type: 'mark-drop', ms: bar(64) })
    expect(s.notice).toBe('too-many')
    expect(s.cues).toEqual(start.cues)
    expect(s.past).toEqual(start.past)
  })

  it('warns when the flow alone asks for more hot cues than rekordbox has letters', () => {
    const start = startDraft([], 'many')
    const s = runWide(start, { type: 'mark-drop', ms: bar(64) })
    expect(s.notice).toBe('too-many')
    expect(s.cues).toEqual([])
  })

  it('takes the whole placement away with one undo', () => {
    const placed = runWide(startDraft([], 'mixed'), { type: 'mark-drop', ms: bar(64) })
    expect(placed.cues).toHaveLength(3)
    expect(placed.past).toHaveLength(1)
    const s = reduceDraft(placed, { type: 'undo' }, wide)
    expect(s.cues).toEqual([])
    expect(s.past).toEqual([])
  })

  it('draws Mi flujo for a point marked after unmarked placements, keeping those as the DJ placed them', () => {
    const s = runWide(
      startDraft([], 'quiet'),
      { type: 'mark-drop', ms: bar(64) },
      { type: 'mark-drop', ms: bar(160) },
      { type: 'use-flow', flowId: 'mine' },
      { type: 'mark-drop', ms: bar(192) },
    )
    expect(s.notice).toBeNull()
    expect(draftDrops(s.cues)).toEqual([bar(192)])
    expect(hotOf(s).map(([ms]) => ms)).toEqual([bar(32), bar(128), bar(144), bar(160), bar(176)])
    expect(hotOf(s).slice(0, 2)).toEqual([
      [bar(32), 1, 22],
      [bar(128), 2, 22],
    ])
    expect(validWantedSet(wantedOfDraft(s.cues), [])).toEqual({ ok: true })
  })

  it('keeps every set main accepts after two unmarked placements', () => {
    const s = runWide(
      startDraft([], 'mixed'),
      { type: 'mark-drop', ms: bar(64) },
      { type: 'mark-drop', ms: bar(160) },
    )
    expect(wantedOfDraft(s.cues)).toHaveLength(4)
    expect(validWantedSet(wantedOfDraft(s.cues), [])).toEqual({ ok: true })
  })
})

describe('ghostOf', () => {
  it('shows what a click would place with Mi flujo, the CALL of the point and each hot cue with its CALL, and the click places exactly that', () => {
    const action: DraftAction = { type: 'mark-drop', ms: bar(64) }
    const g = ghostOf(empty(), action, wide)
    expect(g.gone).toEqual([])
    expect(g.added).toHaveLength(7)
    expect(shape(throughGhost(empty(), action))).toEqual(
      shape(reduceDraft(empty(), action, wide).cues),
    )
  })

  it('shows only the CALL of the point and the hot cue 32 bars before with Una cue a 32', () => {
    const one = startDraft([], 'one-at-32')
    const g = ghostOf(one, { type: 'mark-drop', ms: bar(64) }, wide)
    expect(g.added.map((c) => [c.ms, c.kind]).sort((a, b) => a[0] - b[0])).toEqual([
      [bar(32), 1],
      [bar(64), 0],
    ])
  })

  it.each([
    ['a flow that leaves the point unmarked', 'quiet'],
    ['a flow mixing rules from the point and from the track', 'mixed'],
  ])('equals the commit for %s', (_name, flowId) => {
    const action: DraftAction = { type: 'mark-drop', ms: bar(64) }
    const s = startDraft([], flowId)
    expect(shape(throughGhost(s, action))).toEqual(shape(reduceDraft(s, action, wide).cues))
  })

  it('shows the whole result of a flow that does not depend on the point, the same as applying it', () => {
    const s = startDraft([], 'chorus')
    const action: DraftAction = { type: 'apply-flow', flowId: 'chorus' }
    expect(ghostOf(s, action, wide).added.map((c) => c.ms)).toEqual([bar(64), bar(128)])
    expect(shape(throughGhost(s, action))).toEqual(shape(reduceDraft(s, action, wide).cues))
  })

  it('shows what switching a marked track to another flow takes away and adds, and changes nothing by itself', () => {
    const marked = runWide(empty(), { type: 'mark-drop', ms: bar(64) })
    const before = JSON.stringify(marked)
    const action: DraftAction = { type: 'apply-flow', flowId: 'one-at-32' }
    const g = ghostOf(marked, action, wide)
    expect(g.gone.length).toBeGreaterThan(0)
    expect(g.added.some((c) => c.kind === 1 && c.ms === bar(32))).toBe(true)
    expect(shape(throughGhost(marked, action))).toEqual(
      shape(reduceDraft(marked, action, wide).cues),
    )
    expect(JSON.stringify(marked)).toBe(before)
  })

  it('shows nothing over a point that is already marked, where a click changes nothing', () => {
    const marked = runWide(empty(), { type: 'mark-drop', ms: bar(64) })
    expect(ghostOf(marked, { type: 'mark-drop', ms: bar(64) + 10 }, wide)).toEqual({
      added: [],
      gone: [],
      rejected: [],
    })
  })
})

describe('quantize of hand-placed cues', () => {
  const grid = beats.map((ms, i) => ({ ms, beat: (i % 4) + 1 }))
  const quantized = (unit: 'bar' | 'beat') => ({ ...ctx, snapTo: quantizePoints(grid, unit) })
  const runWith = (unit: 'bar' | 'beat', state: CueDraft, ...actions: DraftAction[]) =>
    actions.reduce((s, a) => reduceDraft(s, a, quantized(unit)), state)

  it('draws the flow on the bar start under the cursor, where the click will put it', () => {
    const g = ghostOf(empty(), { type: 'mark-drop', ms: bar(64) + 600 }, quantized('bar'))
    expect(g.added.filter((c) => c.kind === 0).map((c) => c.ms)).toContain(bar(64))
    expect(g.added.some((c) => c.ms === bar(64) + 500)).toBe(false)
  })

  it('marks a drop on the nearest bar start when quantizing to the bar, because drops start phrases', () => {
    expect(
      draftDrops(runWith('bar', empty(), { type: 'mark-drop', ms: bar(64) + 600 }).cues),
    ).toEqual([bar(64)])
    expect(
      draftDrops(runWith('bar', empty(), { type: 'mark-drop', ms: bar(64) + 1500 }).cues),
    ).toEqual([bar(65)])
  })

  it('marks a drop on the nearest beat when quantizing to the beat', () => {
    expect(
      draftDrops(runWith('beat', empty(), { type: 'mark-drop', ms: bar(64) + 600 }).cues),
    ).toEqual([bar(64) + 500])
  })

  it('adds a CALL on the bar line instead of between two bar lines', () => {
    expect(
      at(runWith('bar', empty(), { type: 'add-call', ms: bar(10) + 900 }), bar(10), false),
    ).toBeDefined()
    expect(
      at(runWith('beat', empty(), { type: 'add-call', ms: bar(10) + 900 }), bar(10) + 1000, false),
    ).toBeDefined()
  })

  it('adds a hot cue on the nearest bar start or the nearest beat', () => {
    expect(
      at(runWith('bar', empty(), { type: 'add-hot', ms: bar(10) + 1100 }), bar(11), true),
    ).toBeDefined()
    expect(
      at(runWith('beat', empty(), { type: 'add-hot', ms: bar(10) + 1100 }), bar(10) + 1000, true),
    ).toBeDefined()
  })

  it('drops a dragged mark on the nearest bar start or the nearest beat', () => {
    const s = startDraft([{ id: 'a', ms: bar(8), kind: 1, color: 4 }], 'mine')
    expect(runWith('bar', s, { type: 'move', key: 'a', ms: bar(20) + 700 }).cues[0].ms).toBe(
      bar(20),
    )
    expect(runWith('beat', s, { type: 'move', key: 'a', ms: bar(20) + 700 }).cues[0].ms).toBe(
      bar(20) + 500,
    )
  })

  it('leaves the cues read from rekordbox where they are, even off the bar', () => {
    const live = [{ id: 'r', ms: bar(5) + 500, kind: 1, color: 4 }]
    const s = runWith('bar', startDraft(live, 'mine'), { type: 'add-call', ms: bar(30) })
    expect(at(s, bar(5) + 500, true)).toBeDefined()
    expect(validWantedSet(wantedOfDraft(s.cues), live)).toEqual({ ok: true })
  })
})

describe('ghostOf rejected', () => {
  const strong = { ...ctx, strong: [{ start: bar(30), end: bar(40) }] }
  const reasons = (g: { rejected: { ms: number; reason: string }[] }) =>
    g.rejected.map((c) => [c.ms, c.reason])

  it('lists what the flow drops at the hovered point and why, so the ghost can show it', () => {
    const g = ghostOf(empty(), { type: 'mark-drop', ms: bar(64) }, strong)
    expect(reasons(g)).toEqual([
      [bar(32), 'strong'],
      [bar(16), 'strong'],
    ])
  })

  it('lists only what the new point drops, not what earlier points already dropped', () => {
    const s = reduceDraft(empty(), { type: 'mark-drop', ms: bar(64) }, strong)
    expect(reasons(ghostOf(s, { type: 'mark-drop', ms: bar(160) }, strong))).toEqual([])
  })

  it('lists the drops of a flow that leaves the point unmarked even when it places nothing there', () => {
    const quiet: CueFlow = { ...ONE_AT_32, id: 'quiet', markPoint: false }
    const g = ghostOf(
      startDraft([], 'quiet'),
      { type: 'mark-drop', ms: bar(64) },
      { ...strong, flows: [...KEPT, quiet] },
    )
    expect(g.added).toEqual([])
    expect(reasons(g)).toEqual([[bar(32), 'strong']])
  })

  it('lists nothing on a point already marked, where a click changes nothing', () => {
    const s = reduceDraft(empty(), { type: 'mark-drop', ms: bar(64) }, strong)
    expect(ghostOf(s, { type: 'mark-drop', ms: bar(64) }, strong).rejected).toEqual([])
  })

  it('lists what another flow would drop over the whole track when it is applied', () => {
    const s = reduceDraft(empty(), { type: 'mark-drop', ms: bar(64) }, strong)
    const g = ghostOf(s, { type: 'apply-flow', flowId: 'one-at-32' }, strong)
    expect(reasons(g)).toEqual([[bar(32), 'strong']])
  })
})

describe('correcting a point', () => {
  const shape = (s: CueDraft) =>
    s.cues
      .map((c) => `${c.ms}:${c.kind}:${c.color}`)
      .sort()
      .join(' ')
  const callAt = (s: CueDraft, ms: number) =>
    s.cues.find((c) => c.kind === 0 && c.ms === ms)?.key as string
  const intro = { ...ctx, strong: [{ start: bar(40), end: bar(60) }] }

  it('takes away the cues the flow generated from a point when its CALL is deleted, in one undo step', () => {
    const placed = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const s = run(placed, { type: 'remove-point', key: callAt(placed, bar(64)) })
    expect(s.cues).toEqual([])
    expect(shape(run(s, { type: 'undo' }))).toBe(shape(placed))
  })

  it('keeps what the DJ placed or edited by hand, the loops and the cues of the other points', () => {
    const loop = { id: 'L', ms: bar(100), kind: 0, color: null }
    const two = run(
      startDraft([loop], 'mine', ['L']),
      { type: 'mark-drop', ms: bar(64) },
      { type: 'mark-drop', ms: bar(160) },
      { type: 'add-call', ms: bar(56) },
    )
    const b = at(two, bar(32), true) as DraftCue
    const recoloured = run(two, { type: 'recolour', key: b.key, color: 5 })
    const s = run(recoloured, { type: 'remove-point', key: callAt(recoloured, bar(64)) })
    expect(at(s, bar(32), true)?.color).toBe(5)
    expect(at(s, bar(32), false)).toBeDefined()
    expect(at(s, bar(16), true)).toBeUndefined()
    expect(at(s, bar(48), true)).toBeUndefined()
    expect(at(s, bar(56), false)).toBeDefined()
    expect(at(s, bar(100), false)).toBeDefined()
    expect(at(s, bar(64), false)).toBeUndefined()
    expect(draftDrops(s.cues, s.locked)).toEqual([bar(56), bar(160)])
    expect(s.cues.filter((c) => c.kind !== 0)).toHaveLength(4)
  })

  it('leaves no orphan after place, delete the CALL, place elsewhere, so the result is a clean placement', () => {
    const placed = reduceDraft(empty(), { type: 'mark-drop', ms: bar(64) }, intro)
    expect(at(placed, 0, true)).toBeDefined()
    const gone = reduceDraft(placed, { type: 'remove-point', key: callAt(placed, bar(64)) }, intro)
    const again = reduceDraft(gone, { type: 'mark-drop', ms: bar(66) }, intro)
    const clean = reduceDraft(empty(), { type: 'mark-drop', ms: bar(66) }, intro)
    expect(shape(again)).toBe(shape(clean))
  })

  it('moves a point by its CALL to the quantized beat and regenerates its cues as a clean placement there, in one undo step', () => {
    const placed = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const s = run(placed, { type: 'move-point', key: callAt(placed, bar(64)), ms: bar(80) + 200 })
    expect(shape(s)).toBe(shape(run(empty(), { type: 'mark-drop', ms: bar(80) })))
    expect(shape(run(s, { type: 'undo' }))).toBe(shape(placed))
  })

  it('moves and deletes a CALL that is no point as before, so a hot cue’s CALL never takes the countdown with it', () => {
    const placed = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const paired = callAt(placed, bar(32))
    const removed = run(placed, { type: 'remove-point', key: paired })
    expect(shape(removed)).toBe(shape(run(placed, { type: 'remove', key: paired })))
    const hot = at(placed, bar(32), true) as DraftCue
    const moved = run(placed, { type: 'move-point', key: hot.key, ms: bar(36) })
    expect(shape(moved)).toBe(shape(run(placed, { type: 'move', key: hot.key, ms: bar(36) })))
  })
})

describe('correcting a point, by provenance', () => {
  const callAt = (s: CueDraft, ms: number) =>
    s.cues.find((c) => c.kind === 0 && c.ms === ms)?.key as string
  const ahead: CueFlow = {
    id: 'ahead',
    name: '',
    markPoint: true,
    rules: [
      {
        from: 'drop',
        direction: 'forward',
        bars: 16,
        repeat: 1,
        when: 'fits',
        place: 'hot',
        color: { fixed: 5 },
      },
    ],
  }
  const withAhead = { ...ctx, flows: [...KEPT, ahead] }

  it('takes away only what the flow that placed the point generated, not what the flow now chosen would', () => {
    const two = [
      { type: 'mark-drop', ms: bar(64) },
      { type: 'mark-drop', ms: bar(128) },
      { type: 'use-flow', flowId: 'ahead' },
    ] as const
    const s = two.reduce((d, a) => reduceDraft(d, a, withAhead), empty())
    expect(at(s, bar(80), true)).toBeDefined()
    const gone = reduceDraft(s, { type: 'remove-point', key: callAt(s, bar(64)) }, withAhead)
    expect(at(gone, bar(80), true)).toBeDefined()
    expect(at(gone, bar(48), true)).toBeUndefined()
  })

  it('never takes away cues the track came with from rekordbox, only the point’s own CALL', () => {
    const saved = [
      { id: 'd', ms: bar(64), kind: 0, color: null },
      ...[16, 32, 48].flatMap((n, i) => [
        { id: `h${n}`, ms: bar(n), kind: i + 1, color: 1 },
        { id: `c${n}`, ms: bar(n), kind: 0, color: null },
      ]),
    ]
    const s = run(startDraft(saved, 'mine'), { type: 'remove-point', key: 'd' })
    expect(s.cues.map((c) => c.key).sort()).toEqual(
      saved
        .filter((c) => c.id !== 'd')
        .map((c) => c.id)
        .sort(),
    )
    const moved = run(startDraft(saved, 'mine'), { type: 'move-point', key: 'd', ms: bar(80) })
    expect(at(moved, bar(16), true)?.key).toBe('h16')
    expect(at(moved, bar(48), true)?.key).toBe('h48')
  })
})

describe('a point move that cannot land', () => {
  it('keeps the point where it was and says why, instead of snapping back in silence', () => {
    const s = run(
      startDraft([], 'calls-only'),
      { type: 'mark-drop', ms: bar(64) },
      ...Array.from({ length: 8 }, (_, i): DraftAction => ({ type: 'add-hot', ms: bar(10 + i) })),
      { type: 'use-flow', flowId: 'one-at-32' },
    )
    const key = s.cues.find((c) => c.kind === 0 && c.ms === bar(64))?.key as string
    const moved = run(s, { type: 'move-point', key, ms: bar(100) })
    expect(moved.cues).toEqual(s.cues)
    expect(moved.notice).toBe('too-many')
    expect(moved.past).toHaveLength(s.past.length)
  })
})

describe('draftPoints', () => {
  const calls: CueFlow = {
    id: 'calls16',
    name: '',
    markPoint: true,
    rules: [
      {
        from: 'drop',
        direction: 'back',
        bars: 16,
        repeat: 2,
        when: 'always',
        place: 'call',
        color: { fixed: 1 },
      },
    ],
  }
  const withCalls = { ...ctx, flows: [...KEPT, calls] }

  it('names as points only the CALLs the flow keeps as points, not the countdown CALLs it generates', () => {
    const s = reduceDraft(startDraft([], 'calls16'), { type: 'mark-drop', ms: bar(64) }, withCalls)
    expect(draftDrops(s.cues, s.locked)).toEqual([bar(32), bar(48), bar(64)])
    expect(draftPoints(s, withCalls)).toEqual([bar(64)])
  })
})
