import { describe, expect, it } from 'vitest'
import { jobPlaylists } from './trackPrograms'

describe('jobPlaylists', () => {
  it('names all eight playlist fields in the job even for a track with none, so the job main receives always has the same keys', () => {
    expect(Object.keys(jobPlaylists({}))).toEqual([
      'rekordboxPlaylists',
      'rekordboxPlaylistsBase',
      'traktorPlaylists',
      'traktorPlaylistsBase',
      'enginePlaylists',
      'enginePlaylistsBase',
      'seratoPlaylists',
      'seratoPlaylistsBase',
    ])
    expect(Object.values(jobPlaylists({}))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })

  it('sends the crates picked for a track with its job', () => {
    expect(
      jobPlaylists({ seratoPlaylists: [{ id: 'A', name: 'A' }], seratoPlaylistsBase: [] }),
    ).toMatchObject({ seratoPlaylists: [{ id: 'A', name: 'A' }], seratoPlaylistsBase: [] })
  })
})
