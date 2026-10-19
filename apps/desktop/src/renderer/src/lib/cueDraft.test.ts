import { describe, expect, it } from 'vitest'
import { BUNDLED_FLOWS } from '../../../shared/cueFlows'
import { type ExistingCue, validWantedSet } from '../../../shared/cueRules'
import {
  type CueDraft,
  type DraftAction,
  draftDrops,
  freeLetters,
  reduceDraft,
  startDraft,
  wantedOfDraft,
} from './cueDraft'

const beats = Array.from({ length: 800 }, (_, i) => i * 500)
const bar = (n: number) => n * 2000
const ctx = { beats, strong: [], phrases: [], flows: BUNDLED_FLOWS }
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

  it('takes the countdown away with the drop when the mark is clicked again', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const drop = at(marked, bar(64), false)
    const s = run(marked, { type: 'unmark-drop', key: drop?.key as string })
    expect(s.cues).toEqual([])
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

  it('ignores an unmark on a cue that is not a drop, leaving no undo step', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const a = at(marked, bar(16), true)
    expect(run(marked, { type: 'unmark-drop', key: a?.key as string })).toBe(marked)
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
