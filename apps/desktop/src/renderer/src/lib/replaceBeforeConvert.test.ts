import { describe, expect, it } from 'vitest'
import { replacePatch } from './replaceBeforeConvert'

// What a track needs stamped on it, before the conversion runs, for the convert to REPLACE
// the library copy instead of adding a second one.
//
// Reported 14/09 with three screenshots: the button said "Replace with AIFF + Apple Music"
// and the result was two entries in Apple Music, two files in the folder, and rekordbox
// still pointing at the old MP3. The label had been wired; the action had not.

describe('replacePatch', () => {
  // musicPersistentId is what turns the Apple Music step from an add into an update of that
  // exact copy — the same field a track earns after Surco adds it. Handing it the copy the
  // file supersedes makes the convert write over that entry instead of creating a sibling.
  it('points the track at the copy it will replace', () => {
    expect(replacePatch({ persistentId: 'PID1', label: 'Transfer - Possession' })).toEqual({
      musicPersistentId: 'PID1',
    })
  })

  // Nothing to replace is the ordinary case: the track is added, exactly as before.
  it('stamps nothing when there is no copy to replace', () => {
    expect(replacePatch(null)).toBeNull()
  })

  // Two equally good matches: replacing on a guess can overwrite the wrong song, so the
  // convert stays an add and the user is left to choose.
  it('stamps nothing when the match is ambiguous', () => {
    expect(replacePatch({ ambiguous: ['PID1', 'PID2'] })).toBeNull()
  })
})
