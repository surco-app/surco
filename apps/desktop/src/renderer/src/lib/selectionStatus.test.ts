import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import { selectionStatus } from './selectionStatus'

function track(over: Partial<TrackItem> & { id: string }): TrackItem {
  return {
    inputPath: `/m/${over.id}.wav`,
    fileName: `${over.id}.wav`,
    listLabel: over.id,
    query: '',
    status: 'idle',
    meta: { title: over.id },
    ...over,
  } as TrackItem
}

describe('selectionStatus', () => {
  // The done footer must only appear once EVERY selected track converted — showing it
  // while one is still pending would offer reveal/add actions for files that don't
  // exist yet.
  it('shows the done block in multi-select only when every track is done', () => {
    const a = track({ id: 'a', status: 'done', outputPath: '/out/a.aiff' })
    const pending = track({ id: 'b', status: 'idle' })
    expect(selectionStatus(a, [a, pending], true).showDone).toBe(false)
    const b = track({ id: 'b', status: 'done', outputPath: '/out/b.aiff' })
    expect(selectionStatus(a, [a, b], true).showDone).toBe(true)
  })

  // "Apple Music only" conversions leave no file in the output folder: a done track
  // without a path must confirm the library add instead of offering a dead reveal.
  it('flags a done selection with no output file as in-library-only', () => {
    const a = track({ id: 'a', status: 'done' })
    const s = selectionStatus(a, undefined, true)
    expect(s.revealPath).toBeUndefined()
    expect(s.inMusicLibraryOnly).toBe(true)
  })

  // An in-place export rewrote the source itself: there is no separate original left
  // to trash, so offering the button would delete the only copy.
  it('never offers delete-original for an in-place export', () => {
    const inPlace = track({ id: 'a', status: 'done', outputPath: '/m/a.wav' })
    expect(selectionStatus(inPlace, undefined, true).canDeleteOriginal).toBe(false)
    const real = track({ id: 'a', status: 'done', outputPath: '/out/a.aiff' })
    expect(selectionStatus(real, undefined, true).canDeleteOriginal).toBe(true)
    const trashed = track({
      id: 'a',
      status: 'done',
      outputPath: '/out/a.aiff',
      originalTrashed: true,
    })
    expect(selectionStatus(trashed, undefined, true).canDeleteOriginal).toBe(false)
  })

  // The Apple Music button reflects the whole selection: busy while any add runs,
  // confirmed only when all landed, and the first failure is what surfaces.
  it('aggregates the Apple Music add state across the selection', () => {
    const added = track({ id: 'a', status: 'done', musicStatus: 'added' })
    const adding = track({ id: 'b', status: 'done', musicStatus: 'adding' })
    const failed = track({ id: 'c', status: 'done', musicStatus: 'error', musicError: 'denied' })
    expect(selectionStatus(added, [added, adding], true).musicAdding).toBe(true)
    expect(selectionStatus(added, [added, adding], true).musicAdded).toBe(false)
    expect(selectionStatus(added, [added, added], true).musicAdded).toBe(true)
    expect(selectionStatus(added, [added, failed], true).musicError).toBe('denied')
  })
})

// A batch of replacements leaves one orphan per track: each superseded file is out of
// Apple Music and rekordbox now follows the new one, so nothing references them. Asked
// 15/09 — "vamos a tener ficheros en disco, pero no en apple music; eso al final es un
// problema" — and with the batch rule in place a single convert can strand ten of them at
// once, so the footer offers them together rather than one link per track.
describe('selectionStatus superseded files', () => {
  const replaced = (id: string) =>
    track({
      id,
      status: 'done',
      outputPath: `/m/${id}.aiff`,
      replacesPath: `/m/${id}-old.mp3`,
    })

  it('collects every superseded file across the selection', () => {
    const a = replaced('a')
    const b = replaced('b')

    expect(selectionStatus(a, [a, b], true).supersededPaths).toEqual([
      '/m/a-old.mp3',
      '/m/b-old.mp3',
    ])
  })

  // A track still converting has not superseded anything yet, and one that failed must
  // leave every file where it was — offering those would invite deleting an original
  // whose replacement never happened.
  it('leaves out tracks whose conversion has not finished', () => {
    const done = replaced('a')
    const running = track({ id: 'b', status: 'processing', replacesPath: '/m/b-old.mp3' })

    expect(selectionStatus(done, [done, running], true).supersededPaths).toEqual(['/m/a-old.mp3'])
  })

  // Already trashed drops out, so the offer shrinks as files go and retires when none are
  // left rather than asking again about something that is gone.
  it('leaves out files already trashed', () => {
    const a = replaced('a')
    const gone = { ...replaced('b'), supersededTrashed: true }

    expect(selectionStatus(a, [a, gone], true).supersededPaths).toEqual(['/m/a-old.mp3'])
  })

  // An ordinary batch supersedes nothing, so there is no offer at all.
  it('collects nothing when the batch replaced no copies', () => {
    const a = track({ id: 'a', status: 'done', outputPath: '/m/a.aiff' })

    expect(selectionStatus(a, [a], true).supersededPaths).toEqual([])
  })

  // Single-select keeps its own per-track link (supersededFile), so the aggregate stays
  // empty there and the two offers can never both appear.
  it('stays empty in single-select', () => {
    const a = replaced('a')

    expect(selectionStatus(a, undefined, true).supersededPaths).toEqual([])
  })
})
