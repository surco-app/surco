import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import { isStale, trackSignature } from './dirty'
import { withReviewedFields } from './reviewedFields'
import { hasStagedEdits } from './sessionEdits'

function row(overrides: Partial<TrackItem> = {}): TrackItem {
  const base: TrackItem = {
    id: 'a',
    inputPath: '/m/a.mp3',
    fileName: 'a',
    listLabel: 'Song',
    query: '',
    status: 'idle',
    meta: {
      title: 'Song',
      artist: 'Dj Lara',
      album: '',
      albumArtist: '',
      year: '',
      genre: '',
      grouping: '',
      comment: '',
      trackNumber: '',
      discNumber: '',
      bpm: '',
      key: '',
      publisher: '',
      catalogNumber: '',
      remixArtist: '',
    },
  }
  return { ...base, diskSignature: trackSignature(base), ...overrides }
}

const ARTIST = { artist: { from: 'Dj Lara', to: 'DJ Lara' } }

describe('withReviewedFields', () => {
  // The file now says the fixed value; a row still counted as edited would write the
  // old spelling back on its next Update.
  it('takes the fixed value and stays clean', () => {
    const next = withReviewedFields(row(), ARTIST)
    expect(next.meta.artist).toBe('DJ Lara')
    expect(hasStagedEdits(next)).toBe(false)
  })

  it('matches the value read in any Unicode form', () => {
    const decomposed = 'José'
    const t = row({ meta: { ...row().meta, artist: decomposed } })
    const next = withReviewedFields(
      { ...t, diskSignature: trackSignature(t) },
      { artist: { from: 'José', to: 'JOSÉ' } },
    )
    expect(next.meta.artist).toBe('JOSÉ')
  })

  // The user typed something else on the row; that is their edit and it stays pending.
  it('keeps a value the user typed over and leaves it pending', () => {
    const t = { ...row(), meta: { ...row().meta, artist: 'Lara' } }
    const next = withReviewedFields(t, ARTIST)
    expect(next.meta.artist).toBe('Lara')
    expect(hasStagedEdits(next)).toBe(true)
  })

  // Another field's edit is still staged, but the fixed field must no longer count as one.
  it('keeps another staged edit pending while the fixed field matches the file', () => {
    const t = { ...row(), meta: { ...row().meta, title: 'Song (Edit)' } }
    const next = withReviewedFields(t, ARTIST)
    const reverted = { ...next, meta: { ...next.meta, title: 'Song' } }
    expect(hasStagedEdits(next)).toBe(true)
    expect(hasStagedEdits(reverted)).toBe(false)
  })

  // The trimmed snapshot already said "Tides"; only the untrimmed read held "Tides ". Left
  // as it was, the next review would offer the fix the file just took.
  it('moves the untrimmed read with the fix, still tied to the disk snapshot', () => {
    const t = row()
    const raw = {
      ...t,
      reviewRaw: { signature: t.diskSignature as string, fields: { album: 'Tides ' } },
    }
    const next = withReviewedFields(raw, { album: { from: 'Tides ', to: 'Tides' } })
    expect(next.reviewRaw).toEqual({ signature: next.diskSignature, fields: { album: 'Tides' } })
  })

  // An undo writes the stray space back; the review must see it again.
  it('puts an undone spelling back on the untrimmed read', () => {
    const t = row({ meta: { ...row().meta, album: 'Tides' } })
    const at = { ...t, diskSignature: trackSignature(t) }
    const raw = { ...at, reviewRaw: { signature: at.diskSignature, fields: { album: 'Tides ' } } }
    const fixed = withReviewedFields(raw, { album: { from: 'Tides ', to: 'Tides' } })
    const undone = withReviewedFields(fixed, { album: { from: 'Tides', to: 'Tides ' } })
    expect(undone.reviewRaw?.fields.album).toBe('Tides ')
    expect(undone.reviewRaw?.signature).toBe(undone.diskSignature)
  })

  it('keeps a converted row from turning stale', () => {
    const t = row({ status: 'done' })
    const next = withReviewedFields({ ...t, processedSignature: t.diskSignature }, ARTIST)
    expect(isStale(next)).toBe(false)
  })

  it('returns the row untouched when nothing on it matches', () => {
    const t = row()
    expect(withReviewedFields(t, { genre: { from: 'House', to: 'Tech House' } })).toBe(t)
  })
})
