import { describe, expect, it } from 'vitest'
import { MY_FLOW } from '../../../shared/cueFlows'
import { HOT_KINDS } from '../../../shared/cueRules'
import { checkOfAudit } from '../../../shared/gridAudit'
import { type EditableGrid, type GridFit, gridBeats } from '../../../shared/gridEdit'
import { type CueDraft, type DraftContext, startDraft } from './cueDraft'
import { adjustGrid } from './gridAdjust'

const BPM = 145
const DURATION_MS = 300000
const TOLERANCE_MS = 10

const beatsOf = (bpm: number, from: number) =>
  Array.from(
    { length: Math.floor(DURATION_MS / (60000 / bpm)) },
    (_, i) => from + (i * 60000) / bpm,
  )

type GriddedDraft = CueDraft & { grid: EditableGrid }

const draftOn = (
  grid: EditableGrid,
  beatIndexes: number[],
  locked: string[] = [],
): GriddedDraft => {
  const beats = gridBeats(grid, DURATION_MS).map((b) => b.ms)
  const draft = startDraft(
    beatIndexes.map((i, n) => ({ id: `c${n}`, ms: beats[i], kind: HOT_KINDS[n], color: null })),
    MY_FLOW.id,
    locked,
    grid,
  )
  return { ...draft, grid }
}

const ctxOf = (draft: GriddedDraft): DraftContext => {
  const beats = gridBeats(draft.grid, DURATION_MS).map((b) => b.ms)
  return { beats, snapTo: beats, strong: [], phrases: [], flows: [MY_FLOW] }
}

const heardOn = (fit: GridFit, kicks: number[]) => async (beats: number[]) => {
  const period = 60000 / fit.bpm
  const windows = beats
    .filter((_, i) => i % 8 === 0)
    .map((ms) => {
      const near = (fit.phases ?? []).reduce<{ ms: number; firstMs: number } | null>(
        (a, p) => (a && Math.abs(a.ms - ms) <= Math.abs(p.ms - ms) ? a : p),
        null,
      )
      const first = near?.firstMs ?? fit.firstMs
      const hit = first + Math.round((ms - first) / period) * period
      return { ms, offsetMs: hit - ms }
    })
  return checkOfAudit(
    { windows, total: windows.length, periodMs: period, heardPerMinute: 30 },
    kicks,
  )
}

const adjust = (
  draft: GriddedDraft,
  fit: GridFit,
  kicks: number[],
  zones: boolean,
  beats: number[] = ctxOf(draft).beats,
) =>
  adjustGrid({
    draft,
    ctx: ctxOf(draft),
    beats,
    fit,
    kicks,
    durationMs: DURATION_MS,
    toleranceMs: TOLERANCE_MS,
    zones,
    checkOf: heardOn(fit, kicks),
  })

const msByKey = (draft: CueDraft) => new Map(draft.cues.map((c) => [c.key, c.ms]))

describe('adjustGrid', () => {
  it('fixes a grid 102 ms late and carries its cues about 100 ms, like Alfonso Nicolás', async () => {
    const draft = draftOn({ bpm: BPM, anchorMs: 102 }, [32, 160, 400])
    const result = await adjust(draft, { bpm: BPM, firstMs: 0 }, beatsOf(BPM, 0), true)
    expect(result.kind).toBe('adjusted')
    if (result.kind !== 'adjusted') return
    const before = msByKey(draft)
    for (const cue of result.draft.cues)
      expect(cue.ms - (before.get(cue.key) as number)).toBeCloseTo(-102, 0)
  })

  it('sets aside a track whose heard tempo disagrees with the program, like Club Robbers', async () => {
    const draft = draftOn(
      {
        bpm: BPM,
        anchorMs: 0,
        zones: [
          { fromMs: 100000, bpm: BPM, anchorMs: 100300 },
          { fromMs: 200000, bpm: BPM, anchorMs: 200600 },
        ],
      },
      [50, 300, 600],
    )
    const cues = draft.cues
    const snapshot = structuredClone(draft)
    const result = await adjust(draft, { bpm: 137.9, firstMs: 0 }, beatsOf(137.9, 0), true)
    expect(result).toEqual({
      kind: 'review',
      reason: { kind: 'tempo', heardBpm: 137.9, programBpm: BPM },
    })
    expect(draft.cues).toBe(cues)
    expect(draft).toEqual(snapshot)
  })

  it('sets aside a track whose zones Auto would flatten at the same tempo, since its cues would move more than half a beat', async () => {
    const draft = draftOn(
      { bpm: BPM, anchorMs: 0, zones: [{ fromMs: 100000, bpm: BPM, anchorMs: 100300 }] },
      [50, 300],
    )
    const result = await adjust(draft, { bpm: BPM, firstMs: 0 }, beatsOf(BPM, 0), true)
    expect(result.kind === 'review' && result.reason.kind).toBe('cueJump')
    if (result.kind !== 'review' || result.reason.kind !== 'cueJump') return
    expect(Math.abs(result.reason.ms)).toBeGreaterThan(30000 / BPM)
  })

  it('sets aside a track the fit does not improve, like Then Jerico', async () => {
    const phases = Array.from({ length: 46 }, (_, i) => ({
      ms: 3200 + i * 6400,
      firstMs: i < 15 ? 0 : 19,
    }))
    const draft = draftOn({ bpm: BPM, anchorMs: 15 }, [32, 160])
    const result = await adjust(draft, { bpm: BPM, firstMs: 0, phases }, beatsOf(BPM, 0), false)
    expect(result.kind === 'review' && result.reason.kind).toBe('noBetter')
  })

  it('leaves a track it cannot hear for the DJ to look at, never adjusting it blind', async () => {
    const draft = draftOn({ bpm: BPM, anchorMs: 102 }, [32, 160])
    const result = await adjustGrid({
      draft,
      ctx: ctxOf(draft),
      beats: ctxOf(draft).beats,
      fit: { bpm: BPM, firstMs: 0 },
      kicks: beatsOf(BPM, 0),
      durationMs: DURATION_MS,
      toleranceMs: TOLERANCE_MS,
      zones: true,
      checkOf: async () => null,
    })
    expect(result).toEqual({ kind: 'unmeasured' })
  })

  it('leaves a grid already on the kicks untouched so a rerun never churns zones', async () => {
    const draft = draftOn({ bpm: BPM, anchorMs: 4 }, [32, 160])
    const result = await adjust(draft, { bpm: BPM, firstMs: 0 }, beatsOf(BPM, 0), true)
    expect(result).toEqual({ kind: 'fine' })
  })

  it('keeps locked loops in place', async () => {
    const draft = draftOn({ bpm: BPM, anchorMs: 102 }, [32, 160], ['c1'])
    const result = await adjust(draft, { bpm: BPM, firstMs: 0 }, beatsOf(BPM, 0), true)
    expect(result.kind).toBe('adjusted')
    if (result.kind !== 'adjusted') return
    const before = msByKey(draft)
    const after = msByKey(result.draft)
    expect(after.get('c1')).toBe(before.get('c1'))
    expect(after.get('c0')).not.toBe(before.get('c0'))
  })

  it('measures the stored beats before adjusting, as the filter does, so a borderline track the filter calls fine stays fine', async () => {
    const draft = draftOn({ bpm: BPM, anchorMs: 11 }, [32, 160, 400])
    const stored = beatsOf(BPM, 0)
    const result = await adjust(draft, { bpm: BPM, firstMs: 0 }, stored, true, stored)
    expect(result).toEqual({ kind: 'fine' })
  })

  it('sets a cue aside when the old grid has too few beats to size half a beat', async () => {
    const shortMs = 300
    const grid = { bpm: BPM, anchorMs: 102 }
    const draft = startDraft(
      [{ id: 'c0', ms: 102, kind: HOT_KINDS[0], color: null }],
      MY_FLOW.id,
      [],
      grid,
    )
    const gridded = { ...draft, grid }
    const beats = gridBeats(grid, shortMs).map((b) => b.ms)
    const result = await adjustGrid({
      draft: gridded,
      beats,
      ctx: { beats, snapTo: beats, strong: [], phrases: [], flows: [MY_FLOW] },
      fit: { bpm: BPM, firstMs: 0 },
      kicks: beatsOf(BPM, 0),
      durationMs: shortMs,
      toleranceMs: TOLERANCE_MS,
      zones: true,
      checkOf: heardOn({ bpm: BPM, firstMs: 0 }, beatsOf(BPM, 0)),
    })
    expect(beats.length).toBeLessThan(2)
    expect(result.kind).not.toBe('adjusted')
  })
})
