import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackItem } from '../types'
import { trackSignature } from './dirty'
import { listReviewEntries, withListChanges } from './listReviewEntries'

function row(path: string, artist: string, over: Partial<TrackItem> = {}): TrackItem {
  const meta = { ...emptyMetadata(), title: 'Song', artist }
  return {
    id: path,
    inputPath: path,
    fileName: path,
    listLabel: 'Song',
    query: '',
    status: 'idle',
    meta,
    duration: 351.4,
    diskSignature: trackSignature({ meta }),
    ...over,
  }
}

describe('listReviewEntries', () => {
  it('reads each loaded row by its path, with the length in whole seconds', () => {
    expect(listReviewEntries([row('/m/a.aiff', 'DJ Ter')])).toEqual({
      entries: [
        {
          id: '/m/a.aiff',
          title: 'Song',
          artist: 'DJ Ter',
          albumArtist: '',
          album: '',
          genre: '',
          durationSec: 351,
        },
      ],
      skipped: 0,
    })
  })

  // The review writes over the file, so it has to look at the file: an artist typed in
  // the editor and not saved yet is the user's pending work, not what is on disk.
  it('reads what is on disk, not an edit waiting in the editor', () => {
    const r = row('/m/a.aiff', 'Dj Lara')
    const edited = { ...r, meta: { ...r.meta, artist: 'Someone Else' } }
    expect(listReviewEntries([edited]).entries[0].artist).toBe('Dj Lara')
  })

  // A row still reading, or one whose read failed, holds a file-name parse: grouping it
  // would offer to "fix" values the file never had.
  it('leaves out rows not read, failed or converting, and counts them', () => {
    const out = listReviewEntries([
      row('/m/a.aiff', 'A'),
      row('/m/b.aiff', 'B', { loadingMeta: true }),
      row('/m/c.aiff', 'C', { metaReadFailed: true }),
      row('/m/d.aiff', 'D', { diskSignature: undefined }),
      row('/m/e.aiff', 'E', { status: 'processing' }),
    ])
    expect(out.entries.map((e) => e.id)).toEqual(['/m/a.aiff'])
    expect(out.skipped).toBe(4)
  })

  it('has no length for a row whose probe found none', () => {
    expect(
      listReviewEntries([row('/m/a.aiff', 'A', { duration: undefined })]).entries[0],
    ).not.toHaveProperty('durationSec')
  })
})

describe('withListChanges', () => {
  // The list commits its own patch a render later; a recount in between must not show the
  // old spelling as still to fix, and a value the rows already carry stays as it is.
  it('applies what the review wrote and drops what it trashed', () => {
    const { entries } = listReviewEntries([
      row('/m/a.aiff', 'Dj Lara'),
      row('/m/b.aiff', 'DJ Lara'),
    ])
    const out = withListChanges(
      entries,
      [{ path: '/m/a.aiff', fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } }],
      new Set(['/m/b.aiff']),
    )
    expect(out.map((e) => [e.id, e.artist])).toEqual([['/m/a.aiff', 'DJ Lara']])
    expect(
      withListChanges(
        out,
        [{ path: '/m/a.aiff', fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } }],
        new Set(),
      ),
    ).toEqual(out)
  })

  it('replays an undo after the apply, in order', () => {
    const { entries } = listReviewEntries([row('/m/a.aiff', 'Dj Lara')])
    const out = withListChanges(
      entries,
      [
        { path: '/m/a.aiff', fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } },
        { path: '/m/a.aiff', fields: { artist: { from: 'DJ Lara', to: 'Dj Lara' } } },
      ],
      new Set(),
    )
    expect(out[0].artist).toBe('Dj Lara')
  })
})
