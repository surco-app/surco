import { describe, expect, it } from 'vitest'
import { jobPlaylists } from './trackPrograms'

describe('jobPlaylists', () => {
  it('names the playlists field in the job even for a track with none, so the job main receives always has the same keys', () => {
    expect(Object.keys(jobPlaylists({}))).toEqual(['playlists'])
    expect(Object.values(jobPlaylists({}))).toEqual([undefined])
  })

  it('sends the crates picked for a track with its job', () => {
    expect(
      jobPlaylists({ playlists: { serato: { targets: [{ id: 'A', name: 'A' }], base: [] } } }),
    ).toMatchObject({ playlists: { serato: { targets: [{ id: 'A', name: 'A' }], base: [] } } })
  })
})
