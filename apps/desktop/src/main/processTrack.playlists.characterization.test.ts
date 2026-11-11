import { describe, expect, it } from 'vitest'
import type { ProcessJob } from '../shared/types'
import { JOB_PLAYLISTS } from './processTrack'

const job = (over: Partial<ProcessJob>): ProcessJob => over as ProcessJob

describe('JOB_PLAYLISTS', () => {
  it('gives rekordbox no base when the job has none, since an absent base means the membership was never read', () => {
    const choice = JOB_PLAYLISTS.rekordbox(
      job({ playlists: { rekordbox: { targets: [{ name: 'R' }] } } }),
    )
    expect(choice).toEqual({ wanted: [{ name: 'R' }], base: undefined })
    expect(choice && 'base' in choice).toBe(true)
  })

  it.each(['traktor', 'engine', 'serato'] as const)(
    'gives %s an empty base when the job has none',
    (program) => {
      const choice = JOB_PLAYLISTS[program](
        job({ playlists: { [program]: { targets: [{ id: 'x', name: 'X' }] } } }),
      )
      expect(choice).toEqual({ wanted: [{ id: 'x', name: 'X' }], base: [] })
    },
  )

  it.each(['rekordbox', 'traktor', 'engine', 'serato'] as const)(
    'ignores a %s base without targets, so no playlist work is queued',
    (program) => {
      expect(
        JOB_PLAYLISTS[program](job({ playlists: { [program]: { base: ['1'] } } })),
      ).toBeUndefined()
    },
  )

  it.each(['rekordbox', 'traktor', 'engine', 'serato'] as const)(
    'treats empty %s targets as a choice, so leaving every playlist is still attached',
    (program) => {
      const choice = JOB_PLAYLISTS[program](
        job({ playlists: { [program]: { targets: [], base: ['1'] } } }),
      )
      expect(choice).toEqual({ wanted: [], base: ['1'] })
    },
  )

  it('returns nothing for a job with no playlists', () => {
    for (const program of ['rekordbox', 'traktor', 'engine', 'serato'] as const)
      expect(JOB_PLAYLISTS[program](job({}))).toBeUndefined()
  })

  it('queues no VirtualDJ playlist work, since Surco does not write VirtualDJ lists yet', () => {
    expect(
      JOB_PLAYLISTS.virtualdj(
        job({ playlists: { virtualdj: { targets: [{ id: 'x', name: 'X' }] } } }),
      ),
    ).toBeUndefined()
  })
})
