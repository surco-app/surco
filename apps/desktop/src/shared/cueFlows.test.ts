import { describe, expect, it } from 'vitest'
import {
  activeCueFlow,
  BUNDLED_FLOWS,
  CALLS_ONLY,
  type CueFlow,
  type CueRule,
  followsPoint,
  keepLegacyFlow,
  MANUAL_CUE_FLOW,
  MIX_IN,
  MIX_IN_32,
  MY_FLOW,
  normalizeCueFlows,
  ONE_AT_32,
  phraseKindOf,
  phraseLabelOf,
  restoreDefaultFlow,
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

  it('ships Mix in 64 first and as the default, one green cue 64 beats (16 bars) before the point and a CALL on it', () => {
    expect(MIX_IN.rules).toEqual([
      {
        from: 'drop',
        direction: 'back',
        bars: 16,
        repeat: 1,
        when: 'fits',
        place: 'hot',
        color: { fixed: 22 },
      },
    ])
    expect(MIX_IN.markPoint).toBe(true)
    expect(CALLS_ONLY.rules).toEqual([])
    expect(BUNDLED_FLOWS.map((f) => f.id)).toEqual(['mix-in', 'mix-in-32'])
  })

  it('ships Mix in 32 right after it, the same cue 32 beats (8 bars) before the point', () => {
    expect(MIX_IN_32).toEqual({
      ...MIX_IN,
      id: 'mix-in-32',
      rules: [{ ...MIX_IN.rules[0], bars: 8 }],
    })
  })

  it('keeps Una cue a 32 as an earlier flow a DJ may still have, brought back when it is the active one', () => {
    expect(ONE_AT_32.rules[0].bars).toBe(32)
    expect(keepLegacyFlow([MIX_IN], 'one-at-32')).toEqual([MIX_IN, ONE_AT_32])
  })
})

describe('phraseLabelOf', () => {
  // The phrase band shows what rekordbox calls each phrase, so a DJ reads the same words
  // there as in rekordbox; the flows' five kinds fold verses and the bridge away.
  it('names high mood phrases as rekordbox does', () => {
    expect([1, 2, 3, 5, 6].map((k) => phraseLabelOf(1, k))).toEqual([
      'Intro',
      'Up',
      'Down',
      'Chorus',
      'Outro',
    ])
  })

  it('keeps the six verses and the bridge of a mid mood track', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => phraseLabelOf(2, k))).toEqual([
      'Intro',
      'Verse 1',
      'Verse 2',
      'Verse 3',
      'Verse 4',
      'Verse 5',
      'Verse 6',
      'Bridge',
      'Chorus',
      'Outro',
    ])
  })

  it('folds a low mood track into its two verses, as rekordbox labels them', () => {
    expect([2, 3, 4, 5, 6, 7, 8].map((k) => phraseLabelOf(3, k))).toEqual([
      'Verse 1',
      'Verse 1',
      'Verse 1',
      'Verse 2',
      'Verse 2',
      'Verse 2',
      'Bridge',
    ])
  })

  it('names nothing it does not know', () => {
    expect(phraseLabelOf(1, 4)).toBeNull()
    expect(phraseLabelOf(2, 11)).toBeNull()
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
  it('gives the bundled flow to a settings file written before flows existed', () => {
    expect(normalizeCueFlows(undefined)).toEqual([MIX_IN, MIX_IN_32])
  })

  it('puts the default flow back when a synced file lost it, because the app falls back to it', () => {
    const mine: CueFlow = { id: 'x', name: 'Solo 64', markPoint: true, rules: [] }
    expect(normalizeCueFlows([mine]).map((f) => f.id)).toEqual(['mix-in', 'mix-in-32', 'x'])
  })

  it('lists the bundled flows first, as stored, and the flows of the DJ after them in their order', () => {
    const mine: CueFlow = { id: 'x', name: 'Subidón', markPoint: true, rules: [] }
    const edited: CueFlow = { ...MIX_IN_32, name: 'Corta' }
    expect(normalizeCueFlows([mine, edited, MIX_IN])).toEqual([MIX_IN, edited, mine])
  })

  it('keeps the Mi flujo and Solo CALL an earlier Surco stored, edits included, as flows of the DJ', () => {
    const edited: CueFlow = { ...MY_FLOW, rules: [{ ...MY_FLOW.rules[0], bars: 8 }] }
    const flows = normalizeCueFlows([MIX_IN, edited, ONE_AT_32, CALLS_ONLY])
    expect(flows).toEqual([MIX_IN, MIX_IN_32, edited, ONE_AT_32, CALLS_ONLY])
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
    expect(flows.filter((f) => !f.id.startsWith('mix-in')).map((f) => f.markPoint)).toEqual([
      false,
      true,
    ])
  })

  it('drops a flow whose id is the Manual mode, so Manual never stands for a flow', () => {
    const flows = normalizeCueFlows([
      MIX_IN,
      { id: MANUAL_CUE_FLOW, name: 'Mía', markPoint: true, rules: [] },
    ])
    expect(flows.map((f) => f.id)).toEqual(['mix-in', 'mix-in-32'])
  })
})

describe('keepLegacyFlow', () => {
  it('brings back Mi flujo when it is the active flow and the stored list lacks it, so the DJ keeps working the same way', () => {
    expect(keepLegacyFlow([ONE_AT_32], 'mine')).toEqual([ONE_AT_32, MY_FLOW])
    expect(keepLegacyFlow([ONE_AT_32], 'calls-only')).toEqual([ONE_AT_32])
  })

  it('leaves the list alone when the active flow is there or was never one of the earlier bundled ones', () => {
    const edited: CueFlow = { ...MY_FLOW, name: 'Lo mío', rules: [] }
    expect(keepLegacyFlow([ONE_AT_32, edited], 'mine')).toEqual([ONE_AT_32, edited])
    expect(keepLegacyFlow([ONE_AT_32], 'one-at-32')).toEqual([ONE_AT_32])
    expect(keepLegacyFlow([ONE_AT_32], MANUAL_CUE_FLOW)).toEqual([ONE_AT_32])
    expect(keepLegacyFlow([ONE_AT_32], 'gone')).toEqual([ONE_AT_32])
  })

  it('hands out a copy so editing the kept flow never corrupts the definition', () => {
    keepLegacyFlow([], 'mine')[0].rules[0].bars = 99
    expect(MY_FLOW.rules[0].bars).toBe(16)
  })
})

describe('activeCueFlow', () => {
  const kept: CueFlow[] = [ONE_AT_32, MY_FLOW, CALLS_ONLY]

  it('uses the flow the user chose', () => {
    expect(activeCueFlow({ cueFlows: BUNDLED_FLOWS, activeCueFlow: 'mix-in' })).toBe(MIX_IN)
  })

  it('falls back to the default flow when the chosen flow was deleted on another Mac', () => {
    expect(activeCueFlow({ cueFlows: BUNDLED_FLOWS, activeCueFlow: 'gone' })).toEqual(MIX_IN)
    expect(activeCueFlow({})).toEqual(MIX_IN)
  })

  it('runs the default flow for main while the editor is in Manual, since completing on close is its own switch', () => {
    expect(activeCueFlow({ cueFlows: BUNDLED_FLOWS, activeCueFlow: MANUAL_CUE_FLOW })).toEqual(
      MIX_IN,
    )
  })

  it('keeps running the Mi flujo an earlier Surco stored when in Manual, as completing on close did before', () => {
    expect(activeCueFlow({ cueFlows: kept, activeCueFlow: MANUAL_CUE_FLOW })).toBe(MY_FLOW)
    expect(activeCueFlow({ cueFlows: kept, activeCueFlow: 'gone' })).toBe(MY_FLOW)
  })
})

describe('bundled flows stay pristine', () => {
  const pristine = structuredClone(BUNDLED_FLOWS)

  it('hands out copies from normalizeCueFlows so editing a flow never corrupts the defaults', () => {
    const fromEmpty = normalizeCueFlows(undefined)
    fromEmpty[0].rules[0].bars = 99
    fromEmpty[0].rules.pop()
    const withoutDefault = normalizeCueFlows([{ id: 'x', name: 'A', rules: [] }])
    withoutDefault[0].rules[0].bars = 99
    expect(BUNDLED_FLOWS).toEqual(pristine)
    expect(MIX_IN).toEqual(pristine[0])
  })

  it('hands out copies from restoreDefaultFlow and activeCueFlow', () => {
    restoreDefaultFlow([MIX_IN])[0].rules[0].bars = 99
    activeCueFlow({}).rules[0].bars = 99
    activeCueFlow({ cueFlows: [], activeCueFlow: 'gone' }).rules[0].bars = 99
    expect(BUNDLED_FLOWS).toEqual(pristine)
  })
})

describe('restoreDefaultFlow', () => {
  it('puts the default flow back as Surco ships it and leaves the flows of the DJ alone, Mi flujo included', () => {
    const edited = { ...MIX_IN, name: 'Festival', rules: [] }
    const mine = { ...MY_FLOW, name: 'Lo mío', rules: [] }
    expect(restoreDefaultFlow([edited, mine])).toEqual([MIX_IN, mine])
    const short = { ...MIX_IN_32, name: 'Corta', rules: [] }
    expect(restoreDefaultFlow([edited, short, mine], 'mix-in-32')).toEqual([
      edited,
      MIX_IN_32,
      mine,
    ])
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
