import { describe, expect, it } from 'vitest'
import type { CopyFacts } from './bestCopy'
import { rankGroup } from './duplicateRanks'

const SAME = { correlation: 0.995, residualDb: -20, gainDb: -2 }
const all = () => SAME
const open: CopyFacts = { ext: 'aif', cutoffHz: 22050, fingerprint: 'a', peakCount: 1, crestDb: 13 }
const limited: CopyFacts = {
  ext: 'wav',
  cutoffHz: 22050,
  fingerprint: 'w',
  peakCount: 1978,
  crestDb: 10,
}
const mp3: CopyFacts = {
  ext: 'mp3',
  cutoffHz: 19800,
  hasKnee: true,
  fingerprint: 'm',
  peakCount: 2,
  crestDb: 13,
}

describe('rankGroup', () => {
  it('marks the one copy that beats every other as best', () => {
    expect(rankGroup([limited, open], all)).toEqual([
      { rank: 'worse', count: 2, identical: false, reason: 'peakCount' },
      { rank: 'best', count: 2, identical: false, reason: 'peakCount' },
    ])
  })

  // Three copies must never yield two winners: the row would tell the user to keep both.
  it('names exactly one best among three copies', () => {
    const ranks = rankGroup([mp3, limited, open], all)
    expect(ranks?.filter((r) => r.rank === 'best')).toHaveLength(1)
    expect(ranks?.[2].rank).toBe('best')
  })

  // Each worse row says why it lost to the best, not why the best beat some other copy:
  // the limited WAV is not lossy, it is more limited.
  it('gives each worse copy the reason it lost to the best', () => {
    expect(rankGroup([mp3, limited, open], all)).toEqual([
      { rank: 'worse', count: 3, identical: false, reason: 'lossless' },
      { rank: 'worse', count: 3, identical: false, reason: 'peakCount' },
      { rank: 'best', count: 3, identical: false, reason: 'lossless' },
    ])
  })

  // A copy holding the very audio of the best is just as good to keep; calling it worse
  // would send the user to delete a perfect copy.
  it('marks a copy identical to the best as the same, not worse', () => {
    expect(rankGroup([open, { ...open }, mp3], all)).toEqual([
      { rank: 'best', count: 3, identical: false, reason: 'lossless' },
      { rank: 'same', count: 3, identical: true },
      { rank: 'worse', count: 3, identical: false, reason: 'lossless' },
    ])
  })

  it('marks every copy the same when none beats the others', () => {
    expect(rankGroup([open, { ...open }], all)).toEqual([
      { rank: 'same', count: 2, identical: true },
      { rank: 'same', count: 2, identical: true },
    ])
  })

  // Two different masters that nothing separates are not "the same audio", so the row
  // must not claim they are.
  it('tells copies nothing separates apart from identical ones', () => {
    const otherMaster = { correlation: 0.86, residualDb: -6, gainDb: 0.4 }
    expect(rankGroup([open, { ...open, fingerprint: 'b' }], () => otherMaster)).toEqual([
      { rank: 'same', count: 2, identical: false },
      { rank: 'same', count: 2, identical: false },
    ])
  })

  it('keeps the pair still being compared out of any verdict', () => {
    expect(rankGroup([limited, open], () => undefined)).toBeNull()
  })

  // One copy still analysing hides the whole group: a verdict on partial data could
  // flip once the last copy is measured.
  it('ranks nothing while a copy is not measured yet', () => {
    expect(rankGroup([open, null], all)).toBeNull()
  })
})
