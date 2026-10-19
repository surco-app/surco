import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import { MY_FLOW } from '../shared/cueFlows'
import { diagnoseLearnFlow, learnFlow } from '../shared/learnFlow'
import { rekordboxShareDir } from './rekordboxArtwork'
import { openRekordboxDb, rekordboxRawKey } from './rekordboxDb'
import { readLearnTracks } from './rekordboxLearnFlow'

const copy = process.env.SURCO_LEARN_FLOW_DB
const SCRATCH = '/private/tmp/claude-501/'
const EXAMPLES = 5

describe.skipIf(!copy)('Learn the flow from the DJ’s own collection', () => {
  it('prints the learned flow, its coverage and why tracks miss it, on a copy only', async () => {
    const path = resolve(copy as string)
    expect(path.startsWith(SCRATCH) && !path.includes('/Library/Pioneer')).toBe(true)
    const db =
      openRekordboxDb(path, { readonly: true }) ??
      openRekordboxDb(path, { readonly: true, key: await rekordboxRawKey(path) })
    if (!db) throw new Error('the copy did not open')
    try {
      const read = readLearnTracks(db, rekordboxShareDir(path))
      const tracks = read.tracks.map((t) => t.track)
      const learned = learnFlow(tracks)
      console.log(
        JSON.stringify({
          learned,
          isMyFlow: learned ? isDeepStrictEqual(learned.flow.rules, MY_FLOW.rules) : false,
        }),
      )
      const d = diagnoseLearnFlow(tracks)
      const examples = (mismatches: Record<string, number[] | undefined>) =>
        Object.fromEntries(
          Object.entries(mismatches).map(([reason, indices = []]) => [
            reason,
            {
              tracks: indices.length,
              examples: indices.slice(0, EXAMPLES).map((i) => read.tracks[i].contentId),
            },
          ]),
        )
      console.log(
        JSON.stringify({
          read: {
            withCall: read.withCall,
            missingRow: read.missing.length,
            notAnalysed: read.notAnalysed.length,
            notAnalysedExamples: read.notAnalysed.slice(0, EXAMPLES),
            analysed: read.tracks.length,
          },
          considered: { tracks: d.tracks, noGrid: d.noGrid, noDrop: d.noDrop, marked: d.marked },
          beforeGate: {
            support: d.support,
            rules: d.flow.rules,
            countdownPaired: d.countdownPaired,
            start: d.start,
            isMyFlow: isDeepStrictEqual(d.flow.rules, MY_FLOW.rules),
          },
          matching: d.matching,
          mismatches: examples(d.mismatches),
          myFlow: { matching: d.myFlow.matching, mismatches: examples(d.myFlow.mismatches) },
        }),
      )
    } finally {
      db.close()
    }
  })
})
