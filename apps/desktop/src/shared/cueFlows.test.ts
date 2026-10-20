import { describe, expect, it } from 'vitest'
import {
  activeCueFlow,
  BUNDLED_FLOWS,
  CALLS_ONLY,
  type CueFlow,
  type CueRule,
  followsPoint,
  MANUAL_CUE_FLOW,
  MY_FLOW,
  normalizeCueFlows,
  ONE_AT_32,
  phraseKindOf,
  restoreMyFlow,
} from './cueFlows'

describe('bundled flows', () => {
  it('starts from the rules.py countdown so nothing changes for Vicent', () => {
    expect(MY_FLOW).toEqual({
      id: 'mine',
      name: '',
      markPoint: true,
      rules: [
        {
          from: 'drop',
          direction: 'back',
          bars: 16,
          repeat: 3,
          when: 'fits',
          place: 'both',
          color: { each: [1, 22, 42] },
        },
        {
          from: 'first-beat',
          direction: 'back',
          bars: 0,
          repeat: 1,
          when: 'first',
          place: 'both',
          color: { fixed: 32 },
        },
      ],
    })
  })

  it('offers one green cue 32 bars before the drop and a flow with no rules at all', () => {
    expect(ONE_AT_32.rules).toEqual([
      {
        from: 'drop',
        direction: 'back',
        bars: 32,
        repeat: 1,
        when: 'fits',
        place: 'hot',
        color: { fixed: 22 },
      },
    ])
    expect(CALLS_ONLY.rules).toEqual([])
    expect(BUNDLED_FLOWS.map((f) => f.id)).toEqual(['mine', 'one-at-32', 'calls-only'])
  })
})

describe('phraseKindOf', () => {
  it('reads high mood phrases as rekordbox names them', () => {
    expect([1, 2, 3, 5, 6].map((k) => phraseKindOf(1, k))).toEqual([
      'intro',
      'up',
      'down',
      'chorus',
      'outro',
    ])
  })

  it('reads verses as up and the bridge as down in mid and low moods, where rekordbox has no up or down', () => {
    expect([1, 2, 7, 8, 9, 10].map((k) => phraseKindOf(2, k))).toEqual([
      'intro',
      'up',
      'up',
      'down',
      'chorus',
      'outro',
    ])
    expect(phraseKindOf(3, 9)).toBe('chorus')
  })

  it('leaves a kind it does not know out instead of guessing', () => {
    expect(phraseKindOf(1, 4)).toBeNull()
    expect(phraseKindOf(2, 11)).toBeNull()
  })
})

describe('normalizeCueFlows', () => {
  it('gives the bundled flows to a settings file written before flows existed', () => {
    expect(normalizeCueFlows(undefined)).toEqual(BUNDLED_FLOWS)
  })

  it('puts Mi flujo back when a synced file lost it, because the app falls back to it', () => {
    const mine: CueFlow = { id: 'x', name: 'Solo 64', markPoint: true, rules: [] }
    expect(normalizeCueFlows([mine]).map((f) => f.id)).toEqual(['mine', 'x'])
  })

  it('drops a broken rule and keeps the good ones, so a hand-edited file never crashes the engine', () => {
    const flows = normalizeCueFlows([
      {
        id: 'x',
        name: 'Mixta',
        rules: [
          { ...ONE_AT_32.rules[0], bars: 500 },
          { ...ONE_AT_32.rules[0], color: { each: [] } },
          { ...ONE_AT_32.rules[0], from: 'bridge' },
          { ...ONE_AT_32.rules[0], repeat: 'edge' },
        ],
      },
    ])
    expect(flows.find((f) => f.id === 'x')?.rules).toEqual([
      { ...ONE_AT_32.rules[0], repeat: 'edge' },
    ])
  })

  it('keeps the first of two flows with the same id', () => {
    const flows = normalizeCueFlows([
      MY_FLOW,
      { id: 'x', name: 'A', rules: [] },
      { id: 'x', name: 'B', rules: [] },
    ])
    expect(flows.filter((f) => f.id === 'x').map((f) => f.name)).toEqual(['A'])
  })

  it('marks the point with a CALL for a flow saved before the option existed, as Surco always did', () => {
    const flows = normalizeCueFlows([{ id: 'x', name: 'Vieja', rules: [] }])
    expect(flows.find((f) => f.id === 'x')?.markPoint).toBe(true)
  })

  it('keeps a flow that leaves the point unmarked and repairs a value that is not a boolean', () => {
    const flows = normalizeCueFlows([
      { id: 'a', name: '', markPoint: false, rules: [] },
      { id: 'b', name: '', markPoint: 'no', rules: [] },
    ])
    expect(flows.filter((f) => f.id !== 'mine').map((f) => f.markPoint)).toEqual([false, true])
  })

  it('drops a flow whose id is the Manual mode, so Manual never stands for a flow', () => {
    const flows = normalizeCueFlows([
      MY_FLOW,
      { id: MANUAL_CUE_FLOW, name: 'Mía', markPoint: true, rules: [] },
    ])
    expect(flows.map((f) => f.id)).toEqual(['mine'])
  })
})

describe('activeCueFlow', () => {
  it('uses the flow the user chose', () => {
    expect(activeCueFlow({ cueFlows: BUNDLED_FLOWS, activeCueFlow: 'one-at-32' })).toBe(ONE_AT_32)
  })

  it('falls back to Mi flujo when the chosen flow was deleted on another Mac', () => {
    expect(activeCueFlow({ cueFlows: BUNDLED_FLOWS, activeCueFlow: 'gone' })).toEqual(MY_FLOW)
    expect(activeCueFlow({})).toEqual(MY_FLOW)
  })

  it('runs Mi flujo for main while the editor is in Manual, since completing on close is its own switch', () => {
    expect(activeCueFlow({ cueFlows: BUNDLED_FLOWS, activeCueFlow: MANUAL_CUE_FLOW })).toEqual(
      MY_FLOW,
    )
  })
})

describe('bundled flows stay pristine', () => {
  const pristine = structuredClone(BUNDLED_FLOWS)

  it('hands out copies from normalizeCueFlows so editing a flow never corrupts the defaults', () => {
    const fromEmpty = normalizeCueFlows(undefined)
    fromEmpty[0].rules[0].bars = 99
    fromEmpty[0].rules.pop()
    const withoutMine = normalizeCueFlows([{ id: 'x', name: 'A', rules: [] }])
    withoutMine[0].rules[0].bars = 99
    expect(BUNDLED_FLOWS).toEqual(pristine)
    expect(MY_FLOW).toEqual(pristine[0])
  })

  it('hands out copies from restoreMyFlow and activeCueFlow', () => {
    restoreMyFlow([MY_FLOW])[0].rules[0].bars = 99
    activeCueFlow({}).rules[0].bars = 99
    activeCueFlow({ cueFlows: [], activeCueFlow: 'gone' }).rules[0].bars = 99
    expect(BUNDLED_FLOWS).toEqual(pristine)
  })
})

describe('restoreMyFlow', () => {
  it('puts Mi flujo back as rules.py has it and leaves the other flows alone', () => {
    const edited = { ...MY_FLOW, name: 'Lo mío', rules: [] }
    expect(restoreMyFlow([edited, ONE_AT_32])).toEqual([MY_FLOW, ONE_AT_32])
  })
})

describe('followsPoint', () => {
  const only = (rules: CueRule[], markPoint: boolean): CueFlow => ({
    id: 'x',
    name: '',
    markPoint,
    rules,
  })

  it('follows the cursor when the flow marks the point or counts from it, and not when it only reads the track', () => {
    expect(followsPoint(MY_FLOW)).toBe(true)
    expect(followsPoint(CALLS_ONLY)).toBe(true)
    expect(followsPoint(only([ONE_AT_32.rules[0]], false))).toBe(true)
    expect(followsPoint(only([MY_FLOW.rules[1]], false))).toBe(true)
    expect(followsPoint(only([{ ...MY_FLOW.rules[1], when: 'always' }], false))).toBe(false)
    expect(followsPoint(only([{ ...ONE_AT_32.rules[0], from: 'chorus' }], false))).toBe(false)
    expect(followsPoint(only([], false))).toBe(false)
  })
})
