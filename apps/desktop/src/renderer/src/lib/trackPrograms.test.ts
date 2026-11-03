import { describe, expect, it } from 'vitest'
import { jobPlaylists } from './trackPrograms'

describe('jobPlaylists', () => {
  it('names all six playlist fields in the job even for a track with none, so the job main receives always has the same keys', () => {
    expect(Object.keys(jobPlaylists({}))).toEqual([
      'rekordboxPlaylists',
      'rekordboxPlaylistsBase',
      'traktorPlaylists',
      'traktorPlaylistsBase',
      'enginePlaylists',
      'enginePlaylistsBase',
    ])
    expect(Object.values(jobPlaylists({}))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })
})
