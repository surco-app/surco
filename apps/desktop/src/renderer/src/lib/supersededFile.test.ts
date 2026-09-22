import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import { supersededFile } from './supersededFile'

// Which file a finished replacement leaves behind for the user to discard.
//
// Asked 15/09: "sustituir es sustituir, implica el borrado de la original, o al menos,
// poder moverlas a la papelera". The superseded copy is gone from Apple Music and rekordbox
// now follows the new file, so the old one is referenced by nothing and is pure clutter.
//
// It is offered rather than deleted outright: today alone, three runs looked like a correct
// replacement and were not. An automatic delete in any of them would have destroyed the
// user's only copy. The Trash keeps it recoverable; the click keeps it deliberate.

function track(over: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 't1',
    inputPath: '/downloads/new.flac',
    fileName: 'new.flac',
    listLabel: 'new.flac',
    query: '',
    status: 'done',
    meta: {},
    ...over,
  } as TrackItem
}

describe('supersededFile', () => {
  it('offers the replaced file once the conversion is done', () => {
    expect(supersededFile(track({ replacesPath: '/m/old.mp3', outputPath: '/m/new.aiff' }))).toBe(
      '/m/old.mp3',
    )
  })

  // Nothing was superseded: an ordinary conversion leaves its own source alone, which the
  // clean-up offer lists as the original.
  it('offers nothing when the conversion replaced no copy', () => {
    expect(supersededFile(track({ outputPath: '/m/new.aiff' }))).toBeNull()
  })

  // Mid-conversion the old file may still be in use, and a failed run must leave every
  // file exactly where it was — offering a delete there would invite destroying the
  // original after the replacement did not happen.
  it('offers nothing until the conversion has finished', () => {
    expect(supersededFile(track({ replacesPath: '/m/old.mp3', status: 'processing' }))).toBeNull()
    expect(supersededFile(track({ replacesPath: '/m/old.mp3', status: 'error' }))).toBeNull()
  })

  // Already trashed: the offer retires rather than asking twice about a file that is gone.
  it('offers nothing once it has been trashed', () => {
    expect(
      supersededFile(
        track({ replacesPath: '/m/old.mp3', outputPath: '/m/new.aiff', supersededTrashed: true }),
      ),
    ).toBeNull()
  })

  // The degenerate case a same-path conversion could produce: never offer to delete the
  // very file the track now points at.
  it('never offers the file the conversion just wrote', () => {
    expect(
      supersededFile(track({ replacesPath: '/m/new.aiff', outputPath: '/m/new.aiff' })),
    ).toBeNull()
  })
})
