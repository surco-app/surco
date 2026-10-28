import { describe, expect, it } from 'vitest'
import { type DropModel, pickDrops } from './dropDetect'
import { MIN_TASTE_TRACKS, modelWithTaste, type TasteTrack, tuneDropTaste } from './dropTaste'
import { predictTrees, trainTrees } from './dropTrees'

const BARS = [0, 16, 32, 48, 64, 80]

function tracksOf(count: number, isDrop: (x: number) => boolean): TasteTrack[] {
  return Array.from({ length: count * 2 }, (_, t) => {
    const candidates = BARS.map((bar, i) => ({ bar, features: [((t * 7 + i * 13) % 20) / 20] }))
    return {
      key: `track-${t}`,
      candidates,
      drops: candidates.filter((c) => isDrop(c.features[0])).map((c) => c.bar),
    }
  })
    .filter((t) => t.drops.length > 0)
    .slice(0, count)
}

function shipped(): DropModel {
  const rows = Array.from({ length: 400 }, (_, i) => [(i % 20) / 20])
  const labels = rows.map(([x]) => (x >= 0.5 ? 1 : 0))
  return {
    ...trainTrees(rows, labels, { trees: 30, depth: 2, minLeaf: 10 }),
    picking: { threshold: 0, spacingBars: 8, maxDrops: 99 },
  }
}

const proposed = (model: DropModel, track: TasteTrack): number[] =>
  pickDrops(
    track.candidates.map((c) => ({
      bar: c.bar,
      ms: c.bar,
      score: predictTrees(model, c.features),
    })),
    model.picking,
  )

describe('tuneDropTaste', () => {
  it('waits for enough marked tracks, since a handful would teach Auto noise', () => {
    expect(
      tuneDropTaste(
        tracksOf(MIN_TASTE_TRACKS - 1, (x) => x >= 0.8),
        shipped(),
      ),
    ).toBeNull()
  })

  it('keeps the shipped detector when the DJ marks what it already finds, so learning never makes Auto worse', () => {
    const tuned = tuneDropTaste(
      tracksOf(120, (x) => x >= 0.5),
      shipped(),
    )
    expect(tuned?.taste).toBeNull()
    expect(tuned?.check.before.found).toBe(1)
  })

  it('adopts the DJ’s own taste when it finds their drops better on tracks it did not learn from', () => {
    const base = shipped()
    const tracks = tracksOf(120, (x) => x >= 0.8)
    const tuned = tuneDropTaste(tracks, base)
    expect(tuned?.taste).not.toBeNull()
    expect(tuned?.check.after.right).toBeGreaterThan(tuned?.check.before.right ?? 1)
    const model = modelWithTaste(tuned?.taste ?? null, base)
    const late = tracks[3]
    expect(proposed(model, late)).toEqual(late.drops)
  })

  it('answers how many tracks it learned from and checked on, so the profile can say it', () => {
    const tuned = tuneDropTaste(
      tracksOf(120, (x) => x >= 0.8),
      shipped(),
    )
    expect(tuned?.check.tracks).toBe(120)
    expect(tuned?.check.checked).toBeGreaterThan(0)
    expect(tuned?.check.checked).toBeLessThan(120)
  })
})

describe('modelWithTaste', () => {
  it('runs the shipped detector untouched without a taste', () => {
    const base = shipped()
    expect(modelWithTaste(null, base)).toBe(base)
  })
})
