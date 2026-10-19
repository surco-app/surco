import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import { MY_FLOW } from '../shared/cueFlows'
import { rekordboxShareDir } from './rekordboxArtwork'
import { openRekordboxDb, rekordboxRawKey } from './rekordboxDb'
import { learnFromCollection } from './rekordboxLearnFlow'

const copy = process.env.SURCO_LEARN_FLOW_DB
const SCRATCH = '/private/tmp/claude-501/'

describe.skipIf(!copy)('Learn the flow from the DJ’s own collection', () => {
  it('prints the learned flow and its coverage, on a copy only', async () => {
    const path = resolve(copy as string)
    expect(path.startsWith(SCRATCH) && !path.includes('/Library/Pioneer')).toBe(true)
    const db =
      openRekordboxDb(path, { readonly: true }) ??
      openRekordboxDb(path, { readonly: true, key: await rekordboxRawKey(path) })
    if (!db) throw new Error('the copy did not open')
    try {
      const learned = learnFromCollection(db, rekordboxShareDir(path))
      console.log(
        JSON.stringify({
          learned,
          isMyFlow: learned ? isDeepStrictEqual(learned.flow.rules, MY_FLOW.rules) : false,
        }),
      )
    } finally {
      db.close()
    }
  })
})
