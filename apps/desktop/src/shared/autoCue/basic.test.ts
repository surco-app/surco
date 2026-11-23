import { describe, expect, it } from 'vitest'
import type { FlowPhrase } from '../cueFlows'
import basicEngine, { basicEngine as named } from './basic'
import type { DropInput, DropTaste } from './types'

const BEAT_MS = 500

function gridOf(bars: number): DropInput['grid'] {
  return Array.from({ length: bars * 4 }, (_, i) => ({ ms: i * BEAT_MS, beat: (i % 4) + 1 }))
}

const barMs = (bar: number) => bar * 4 * BEAT_MS

const input = (phrases: FlowPhrase[], grid = gridOf(128)): DropInput => ({
  grid,
  phrases,
  words: new Uint16Array(0),
})

describe('basicEngine', () => {
  it('is the default export too, so the build alias can point at it', () => {
    expect(basicEngine).toBe(named)
  })

  it('proposes a drop where each chorus run starts, snapped to the downbeat', () => {
    const phrases: FlowPhrase[] = [
      { ms: 0, kind: 'intro' },
      { ms: barMs(16) + 120, kind: 'chorus' },
      { ms: barMs(40), kind: 'chorus' },
      { ms: barMs(48), kind: 'down' },
      { ms: barMs(80) + 200, kind: 'chorus' },
    ]
    const out = basicEngine.dropProposals(input(phrases), null)
    expect(out.map((p) => p.ms)).toEqual([barMs(16), barMs(80)])
  })

  it('keeps only the first of two chorus starts closer than 24 bars', () => {
    const phrases: FlowPhrase[] = [
      { ms: barMs(16), kind: 'chorus' },
      { ms: barMs(24), kind: 'down' },
      { ms: barMs(32), kind: 'chorus' },
    ]
    const out = basicEngine.dropProposals(input(phrases), null)
    expect(out.map((p) => p.ms)).toEqual([barMs(16)])
  })

  it('proposes nothing for a track without phrases or without a grid', () => {
    expect(basicEngine.dropProposals(input([]), null)).toEqual([])
    expect(basicEngine.dropProposals(input([{ ms: 1000, kind: 'chorus' }], []), null)).toEqual([])
  })

  it('never claims a proposal is sure, so the editor shows them as doubtful', () => {
    const out = basicEngine.dropProposals(input([{ ms: barMs(16), kind: 'chorus' }]), null)
    expect(out).toHaveLength(1)
    expect(out.every((p) => !p.sure && p.quietBars === 0)).toBe(true)
  })

  it('ignores a taste learned by the official build', () => {
    const taste: DropTaste = {
      trees: [[[1]]],
      picking: { threshold: 0, spacingBars: 4, maxDrops: 9 },
    }
    const phrases: FlowPhrase[] = [
      { ms: barMs(16), kind: 'chorus' },
      { ms: barMs(24), kind: 'down' },
      { ms: barMs(32), kind: 'chorus' },
    ]
    expect(basicEngine.dropProposals(input(phrases), taste)).toEqual(
      basicEngine.dropProposals(input(phrases), null),
    )
  })

  it('cannot learn', () => {
    expect(basicEngine.canLearn).toBe(false)
    expect(basicEngine.minTasteTracks).toBe(0)
    expect(basicEngine.tasteTrackOf(input([]), [barMs(16)])).toBeNull()
    expect(basicEngine.tuneDropTaste([])).toBeNull()
  })
})
