import { describe, expect, it } from 'vitest'
import {
  activeCueFlow,
  BUNDLED_FLOWS,
  CALLS_ONLY,
  type CueFlow,
  type CueRule,
  FLOW_SECTIONS,
  type FlowSection,
  fitWhenEach,
  followsPoint,
  formatRepeatWhen,
  keepLegacyFlow,
  MANUAL_CUE_FLOW,
  MIX_IN,
  MIX_IN_32,
  MY_FLOW,
  normalizeCueFlows,
  ONE_AT_32,
  parseRepeatWhen,
  phraseKindOf,
  phraseLabelOf,
  type RepeatWhen,
  repeatWhenOf,
  restoreDefaultFlow,
  withRepeatWhen,
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

  it('reads until the previous mark back from a saved flow instead of dropping the rule', () => {
    const rule = { ...ONE_AT_32.rules[0], when: 'previous' }
    const flows = normalizeCueFlows([{ id: 'x', name: 'Subidón', rules: [rule] }])
    expect(flows.find((f) => f.id === 'x')?.rules).toEqual([rule])
  })

  it('reads the bars a room rule looks ahead back from a saved flow', () => {
    const base = ONE_AT_32.rules[0]
    const flows = normalizeCueFlows([
      {
        id: 'x',
        name: 'Subidón',
        rules: [{ ...base, from: 'first-beat', bars: 0, when: 'room', gap: 12 }],
      },
    ])
    expect(flows.find((f) => f.id === 'x')?.rules).toEqual([
      { ...base, from: 'first-beat', bars: 0, when: 'room', gap: 12 },
    ])
  })

  it('gives a room rule 8 bars when the file has none and drops one with a broken gap', () => {
    const base = ONE_AT_32.rules[0]
    const flows = normalizeCueFlows([
      {
        id: 'x',
        name: 'Mixta',
        rules: [
          { ...base, when: 'room' },
          { ...base, when: 'room', gap: 0 },
          { ...base, when: 'room', gap: 2.5 },
        ],
      },
    ])
    expect(flows.find((f) => f.id === 'x')?.rules).toEqual([{ ...base, when: 'room', gap: 8 }])
  })

  it('adds no gap to the rules of other conditions, so flows saved before compare equal to the bundled ones', () => {
    const flows = normalizeCueFlows([{ ...MIX_IN, rules: [{ ...MIX_IN.rules[0], gap: 8 }] }])
    expect(flows[0]).toEqual(MIX_IN)
  })

  it('keeps a rule with a condition from a newer Surco aside instead of dropping it, so saving here never deletes it there', () => {
    const good = ONE_AT_32.rules[0]
    const newer = { ...good, when: 'someday', reach: 4 }
    const [flow] = normalizeCueFlows([{ id: 'x', name: 'Nueva', rules: [newer, good] }]).filter(
      (f) => f.id === 'x',
    )
    expect(flow.rules).toEqual([good])
    expect(flow.foreign).toEqual([{ at: 0, rule: newer }])
  })

  it('reads what it set aside the same way again, so a flow goes back and forth between versions unchanged', () => {
    const good = ONE_AT_32.rules[0]
    const once = normalizeCueFlows([
      { id: 'x', name: 'Nueva', rules: [good, { ...good, from: 'bridge' }] },
    ])
    expect(normalizeCueFlows(JSON.parse(JSON.stringify(once)))).toEqual(once)
  })

  it('puts a rule set aside back in its place once this Surco knows its condition', () => {
    const good = ONE_AT_32.rules[0]
    const known = { ...good, when: 'always' }
    const [flow] = normalizeCueFlows([
      { id: 'x', name: 'Nueva', rules: [good], foreign: [{ at: 0, rule: known }] },
    ]).filter((f) => f.id === 'x')
    expect(flow).toEqual({ id: 'x', name: 'Nueva', markPoint: true, rules: [known, good] })
  })

  it('still drops a rule broken beyond an unknown word, so a hand-edited file never crashes the engine', () => {
    const good = ONE_AT_32.rules[0]
    const [flow] = normalizeCueFlows([
      { id: 'x', name: 'Rota', rules: [{ ...good, when: 'someday', bars: 500 }] },
    ]).filter((f) => f.id === 'x')
    expect(flow).toEqual({ id: 'x', name: 'Rota', markPoint: true, rules: [] })
  })

  it('reads the condition of each repetition back from a saved flow, so the 48 stays tied to its breakdown', () => {
    const rule = { ...MY_FLOW.rules[0], whenEach: ['rule', 'rule', 'down'] }
    const flows = normalizeCueFlows([{ id: 'x', name: 'Subidón', rules: [rule] }])
    expect(flows.find((f) => f.id === 'x')?.rules).toEqual([rule])
  })

  it('cuts the conditions of repetitions the rule no longer has, so a shortened rule carries nothing hidden', () => {
    const base = MY_FLOW.rules[0]
    const long = Array.from({ length: 20 }, () => 'up')
    const flows = normalizeCueFlows([
      {
        id: 'x',
        name: 'Corta',
        rules: [
          { ...base, repeat: 2, whenEach: ['fits', 'up', 'down'] },
          { ...base, repeat: 'edge', whenEach: long },
        ],
      },
    ])
    expect(flows.find((f) => f.id === 'x')?.rules.map((r) => r.whenEach)).toEqual([
      ['fits', 'up'],
      long.slice(0, 16),
    ])
  })

  it('stores no condition that only repeats the rule, so the same rule always saves the same way', () => {
    const base = MY_FLOW.rules[0]
    const flows = normalizeCueFlows([
      {
        id: 'x',
        name: 'Igual',
        rules: [
          { ...base, whenEach: ['chorus', 'rule', 'rule'] },
          { ...base, whenEach: ['rule', 'rule'] },
          { ...base, whenEach: [] },
        ],
      },
    ])
    expect(flows.find((f) => f.id === 'x')?.rules).toEqual([
      { ...base, whenEach: ['chorus'] },
      base,
      base,
    ])
  })

  it('keeps the conditions of a rule with one colour or one cue under a word an older Surco sets aside, so opening the flow there never erases them', () => {
    const base = MY_FLOW.rules[0]
    const flows = normalizeCueFlows([
      {
        id: 'x',
        name: 'Un cuadro',
        rules: [
          { ...base, bars: 0, repeat: 1, whenEach: ['down'] },
          { ...base, color: { fixed: 22 }, whenEach: ['all:fits+before:32', 'up'] },
          { ...base, color: { fixed: 22 }, whenEach: ['rule', 'down'] },
        ],
      },
    ])
    expect(flows.find((f) => f.id === 'x')?.rules).toEqual([
      { ...base, bars: 0, repeat: 1, whenEach: ['all:down'] },
      { ...base, color: { fixed: 22 }, whenEach: ['all:fits+before:32'] },
      { ...base, color: { fixed: 22 } },
    ])
  })

  it('writes each set of conditions the one canonical way, so the same flow always saves the same and old flows stay as they were', () => {
    const base = MY_FLOW.rules[0]
    const flows = normalizeCueFlows([
      {
        id: 'x',
        name: 'Canon',
        rules: [
          { ...base, whenEach: ['in:down', 'in:down|up', 'all:fits'] },
          { ...base, whenEach: ['before:32', 'rule', 'fits+before:8+after:16+in:down'] },
        ],
      },
    ])
    expect(flows.find((f) => f.id === 'x')?.rules.map((r) => r.whenEach)).toEqual([
      ['down', 'in:up|down', 'fits'],
      ['before:32', 'rule', 'fits+before:8+after:16+in:down'],
    ])
  })

  it('keeps a rule aside when its conditions cannot be read, a distance this Surco does not offer included', () => {
    const good = MY_FLOW.rules[0]
    const odd = [
      { ...good, whenEach: ['before:33'] },
      { ...good, whenEach: ['after:16+before:32'] },
      { ...good, whenEach: ['in:bridge'] },
      { ...good, color: { fixed: 1 }, whenEach: ['all:soon'] },
      { ...good, bars: 0, repeat: 1, whenEach: ['rule', 'later:4'] },
    ]
    const [flow] = normalizeCueFlows([{ id: 'x', name: 'Nueva', rules: [good, ...odd] }]).filter(
      (f) => f.id === 'x',
    )
    expect(flow.rules).toEqual([good])
    expect(flow.foreign).toEqual(odd.map((rule, i) => ({ at: i + 1, rule })))
  })

  it('ignores conditions that are not a list of words and keeps the rule, so a hand-edited file loses only that', () => {
    const base = MY_FLOW.rules[0]
    const flows = normalizeCueFlows([
      {
        id: 'x',
        name: 'Rara',
        rules: [
          { ...base, whenEach: 'down' },
          { ...base, whenEach: ['down', 3] },
        ],
      },
    ])
    expect(flows.find((f) => f.id === 'x')).toEqual({
      id: 'x',
      name: 'Rara',
      markPoint: true,
      rules: [base, base],
    })
  })

  it('keeps a rule aside when one repetition has a condition from a newer Surco, so saving here never rewrites it', () => {
    const good = MY_FLOW.rules[0]
    const newer = { ...good, whenEach: ['rule', 'bridge'] }
    const [flow] = normalizeCueFlows([{ id: 'x', name: 'Nueva', rules: [good, newer] }]).filter(
      (f) => f.id === 'x',
    )
    expect(flow.rules).toEqual([good])
    expect(flow.foreign).toEqual([{ at: 1, rule: newer }])
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

describe('the conditions of one repetition as a word', () => {
  const none: RepeatWhen = { fits: false, before: null, after: null, sections: [] }
  const subsets = Array.from({ length: 32 }, (_, mask) =>
    FLOW_SECTIONS.filter((_, i) => mask & (1 << i)),
  )
  const every: RepeatWhen[] = [false, true].flatMap((fits) =>
    [null, 32].flatMap((before) =>
      [null, 16].flatMap((after) => subsets.map((sections) => ({ fits, before, after, sections }))),
    ),
  )

  it('writes the conditions that already existed exactly as before, so an older Surco still reads the flows that use nothing new', () => {
    expect(formatRepeatWhen(none)).toBe('rule')
    expect(formatRepeatWhen({ ...none, fits: true })).toBe('fits')
    for (const kind of ['up', 'down', 'chorus'] as FlowSection[])
      expect(formatRepeatWhen({ ...none, sections: [kind] })).toBe(kind)
  })

  it('joins anything else in one fixed order, so two flows that ask the same thing are stored the same', () => {
    expect(formatRepeatWhen({ ...none, fits: true, before: 32 })).toBe('fits+before:32')
    expect(formatRepeatWhen({ ...none, before: 32 })).toBe('before:32')
    expect(formatRepeatWhen({ ...none, sections: ['down', 'up'] })).toBe('in:up|down')
    expect(formatRepeatWhen({ ...none, sections: ['intro'] })).toBe('in:intro')
    expect(formatRepeatWhen({ ...none, sections: ['outro'] })).toBe('in:outro')
    expect(formatRepeatWhen({ fits: true, before: 8, after: 16, sections: ['down'] })).toBe(
      'fits+before:8+after:16+in:down',
    )
    expect(formatRepeatWhen({ ...none, fits: true, sections: ['down'] })).toBe('fits+in:down')
  })

  it('reads back every combination it writes, so no saved condition changes meaning on the way', () => {
    expect(every).toHaveLength(256)
    for (const when of every) {
      const word = formatRepeatWhen(when)
      expect(parseRepeatWhen(word), word).toEqual(when)
      expect(formatRepeatWhen(parseRepeatWhen(word) as RepeatWhen)).toBe(word)
    }
    expect(new Set(every.map(formatRepeatWhen)).size).toBe(256)
  })

  it('refuses a word it cannot read instead of guessing, so the rule is set aside whole', () => {
    for (const word of [
      '',
      'bridge',
      'fits+',
      'fits+fits',
      'before:',
      'before:3',
      'before:032',
      'after:16+before:32',
      'in:',
      'in:up|up',
      'in:up|bridge',
      'all:fits',
    ])
      expect(parseRepeatWhen(word), word).toBeNull()
  })
})

describe('the conditions a repetition has in a rule', () => {
  const none: RepeatWhen = { fits: false, before: null, after: null, sections: [] }
  const each = MY_FLOW.rules[0]
  const fixed: CueRule = { ...each, color: { fixed: 22 } }
  const single: CueRule = { ...MY_FLOW.rules[1], when: 'always' }

  it('gives every repetition of a one colour rule the same conditions, since its one square speaks for all', () => {
    const rule = { ...fixed, whenEach: ['all:before:32'] }
    for (const k of [1, 2, 3]) expect(repeatWhenOf(rule, k)).toEqual({ ...none, before: 32 })
  })

  it('gives each repetition of a colour per repetition rule its own, and none where the rule has none', () => {
    const rule = { ...each, whenEach: ['rule', 'rule', 'in:up|down'] }
    expect(repeatWhenOf(rule, 1)).toEqual(none)
    expect(repeatWhenOf(rule, 3)).toEqual({ ...none, sections: ['up', 'down'] })
    expect(repeatWhenOf(each, 2)).toEqual(none)
  })

  it('stores the conditions of a one colour rule under the marked word, the only form an older Surco will not drop', () => {
    expect(withRepeatWhen(fixed, 0, { ...none, fits: true })).toEqual({
      ...fixed,
      whenEach: ['all:fits'],
    })
    expect(withRepeatWhen(single, 0, { ...none, after: 16 })).toEqual({
      ...single,
      whenEach: ['all:after:16'],
    })
    expect(withRepeatWhen({ ...fixed, whenEach: ['all:fits'] }, 0, none)).toEqual(fixed)
  })

  it('stores the conditions of one repetition at its place and nothing after the last one that has any', () => {
    expect(withRepeatWhen(each, 2, { ...none, sections: ['down'] })).toEqual({
      ...each,
      whenEach: ['rule', 'rule', 'down'],
    })
    expect(withRepeatWhen({ ...each, whenEach: ['fits', 'rule', 'down'] }, 2, none)).toEqual({
      ...each,
      whenEach: ['fits'],
    })
  })

  it('refits the stored conditions when the shape of the rule changes, so a rule never carries a form its shape cannot show', () => {
    expect(fitWhenEach({ ...each, repeat: 2, whenEach: ['fits', 'rule', 'down'] })).toEqual({
      ...each,
      repeat: 2,
      whenEach: ['fits'],
    })
    expect(fitWhenEach({ ...each, bars: 0, repeat: 1, whenEach: ['before:32'] })).toEqual({
      ...each,
      bars: 0,
      repeat: 1,
      whenEach: ['all:before:32'],
    })
    expect(fitWhenEach({ ...each, repeat: 1, whenEach: ['all:before:32'] })).toEqual({
      ...each,
      repeat: 1,
      whenEach: ['before:32'],
    })
  })
})
