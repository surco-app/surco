import { describe, expect, it } from 'vitest'
import { newTrackPaths } from './newTracks'

describe('newTrackPaths', () => {
  it('returns only the folder files not already loaded', () => {
    // The watcher reports the folder's whole current audio list; the point of the feature
    // is to load just the tracks the user does not already have, not re-add the crate.
    const folder = ['/m/old.wav', '/m/new.flac']
    expect(newTrackPaths(folder, ['/m/old.wav'])).toEqual(['/m/new.flac'])
  })

  it('ignores non-audio files dropped into the folder', () => {
    // A folder grows with cover.jpg and notes.txt too; those must never prompt a reload.
    const folder = ['/m/cover.jpg', '/m/track.mp3']
    expect(newTrackPaths(folder, [])).toEqual(['/m/track.mp3'])
  })

  it('is empty when nothing new arrived so no popup is shown', () => {
    expect(newTrackPaths(['/m/a.wav'], ['/m/a.wav'])).toEqual([])
  })
})
