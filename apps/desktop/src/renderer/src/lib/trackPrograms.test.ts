import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import { jobPlaylists, patchedTrack } from './trackPrograms'

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

describe('patchedTrack', () => {
  const serato = { targets: [{ id: 'A', name: 'A' }], base: [] }
  const track = { id: 't', analyzeFailed: true, playlists: { serato } } as unknown as TrackItem

  it('hands back the same track for a patch that changes nothing, so its views and caches stay valid', () => {
    expect(patchedTrack(track, { analyzeFailed: true })).toBe(track)
    expect(patchedTrack(track, { playlists: { serato } })).toBe(track)
    expect(
      patchedTrack({ ...track, analyzeFailed: undefined }, { analyzeFailed: undefined }),
    ).toEqual({
      ...track,
      analyzeFailed: undefined,
    })
  })

  it('makes a new track when a field or one program’s playlists change, keeping the others', () => {
    expect(patchedTrack(track, { analyzeFailed: undefined })).not.toBe(track)
    const rekordbox = { targets: [{ id: 'B', name: 'B' }], base: [] }
    const next = patchedTrack(track, { playlists: { rekordbox } })
    expect(next).not.toBe(track)
    expect(next.playlists).toEqual({ serato, rekordbox })
  })
})
