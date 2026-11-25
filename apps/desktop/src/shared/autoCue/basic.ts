import { nearestBeat } from '../cueRules'
import type { AutoCueEngine } from './engine'
import type { DropInput, DropProposal } from './types'

const MIN_BARS_APART = 24

function dropProposals(input: DropInput): DropProposal[] {
  const downbeats = input.grid.filter((g) => g.beat === 1).map((g) => g.ms)
  if (downbeats.length === 0) return []
  const phrases = [...input.phrases].sort((a, b) => a.ms - b.ms)
  const bars: number[] = []
  phrases.forEach((phrase, i) => {
    if (phrase.kind !== 'chorus' || phrases[i - 1]?.kind === 'chorus') return
    const bar = nearestBeat(downbeats, phrase.ms)
    const last = bars[bars.length - 1]
    if (last !== undefined && bar - last < MIN_BARS_APART) return
    bars.push(bar)
  })
  return bars.map((bar) => ({ ms: downbeats[bar], sure: false, quietBars: 0 }))
}

export const basicEngine: AutoCueEngine = {
  canLearn: false,
  minTasteTracks: 0,
  dropProposals: (input) => dropProposals(input),
  tasteTrackOf: () => null,
  tuneDropTaste: () => null,
}

export default basicEngine
