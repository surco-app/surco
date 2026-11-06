import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem, TrackStatus } from '../types'
import { buildLibraryIndex } from './appleMusicLibrary'
import {
  canProcessTrack,
  convertGate,
  eligibleForBatch,
  leftOutForMissing,
  summarizeBatch,
} from './batch'

function track(id: string, status: TrackStatus, meta: Partial<TrackMetadata> = {}): TrackItem {
  return {
    id,
    inputPath: `/${id}.wav`,
    fileName: id,
    listLabel: meta.title ?? id,
    query: '',
    status,
    meta: {
      title: '',
      artist: '',
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
      ...meta,
    },
  }
}

describe('eligibleForBatch', () => {
  it('includes idle and previously failed tracks', () => {
    const tracks = [track('a', 'idle'), track('b', 'error')]
    expect(eligibleForBatch(tracks, [])).toEqual(['a', 'b'])
  })

  it('skips tracks already done or currently processing', () => {
    const tracks = [track('a', 'done'), track('b', 'processing'), track('c', 'idle')]
    expect(eligibleForBatch(tracks, [])).toEqual(['c'])
  })

  it('returns an empty list when nothing is pending', () => {
    expect(eligibleForBatch([track('a', 'done')], [])).toEqual([])
  })

  it('re-includes a done track edited since it was converted (stale)', () => {
    // After converting, the user fills a tag Discogs lacked (e.g. the year) across the
    // selection; the file no longer matches the editor, so "Convert all" must pick the
    // track up again rather than skip it as already done — otherwise the edit never lands.
    const stale = { ...track('a', 'done', { year: '2000' }), processedSignature: 'old-snapshot' }
    expect(eligibleForBatch([stale], [])).toEqual(['a'])
  })

  it('leaves out a convertible track that is missing a required field', () => {
    // The toolbar "Convert (N)" used to count and enable on status alone, so it offered a
    // batch that would only error the incomplete track. The batch now skips it (it stays
    // flagged in the list) — the same gate the single-track convert button enforces.
    const tracks = [track('a', 'idle', { artist: 'Alex' }), track('b', 'idle')]
    expect(eligibleForBatch(tracks, ['artist'])).toEqual(['a'])
  })
})

describe('leftOutForMissing', () => {
  // "Convert 5 of 6" gave no reason, and the reason sat in the left-out track's own footer.
  // The count says how many a missing required field keeps out and which fields, in the
  // order Settings lists them; tracks out for their state are not this note's business.
  it('counts the tracks a missing required field keeps out and names the fields', () => {
    const tracks = [
      track('a', 'idle', { title: 'T', artist: 'A' }),
      track('b', 'idle', { title: 'T' }),
      track('c', 'idle'),
      track('d', 'done'),
    ]
    expect(leftOutForMissing(tracks, ['title', 'artist'])).toEqual({
      count: 2,
      fields: ['title', 'artist'],
    })
  })
})

describe('convertGate', () => {
  // The header, the editor footer, ⌘⇧↵ and the palette each had their own answer to "what
  // does Convert do with this selection": the header converted 10 of 12 and named the two
  // out for a missing field, the footer refused all 12 for the same two, and only the
  // footer knew about Serato rows and mixed replace/add selections (06/11). One gate, read
  // by all of them, so the two buttons can't contradict each other over one selection.
  it('splits a selection into the rows ready to convert and why the rest stay out', () => {
    const tracks = [
      track('a', 'idle', { title: 'T', artist: 'A' }),
      track('b', 'idle', { title: 'T' }),
      { ...track('c', 'idle', { title: 'T', artist: 'A' }), fromSerato: true },
      track('d', 'done', { title: 'T', artist: 'A' }),
    ]
    const gate = convertGate(tracks, ['title', 'artist'])
    expect(gate.ready.map((t) => t.id)).toEqual(['a'])
    expect(gate.missing).toEqual({ count: 1, fields: ['artist'] })
    expect(gate.serato).toBe(1)
    expect(gate.mixed).toBe(false)
  })

  // A batch that would replace a library copy for some rows and add the others cannot be
  // honestly done by one click, so nothing is ready and the reason is the mix itself.
  it('holds the whole selection back when it mixes replacing a library copy with adding', () => {
    const index = buildLibraryIndex([{ title: 'Sunrise', artist: 'Halo', persistentId: 'PID2' }])
    const tracks = [
      track('a', 'idle', { title: 'Sunrise', artist: 'Halo' }),
      track('b', 'idle', { title: 'Unknown Song', artist: 'Nobody' }),
    ]
    const gate = convertGate(tracks, ['title', 'artist'], [], index)
    expect(gate.ready).toEqual([])
    expect(gate.mixed).toBe(true)
  })

  // The done menu's "Convert again" is a deliberate re-run over converted tracks, so the
  // gate takes done rows too; the plain gate skipped them and the menu converted nothing.
  it('takes done tracks too when the run is a deliberate convert again', () => {
    const tracks = [
      track('a', 'idle', { title: 'T', artist: 'A' }),
      track('b', 'done', { title: 'T', artist: 'A' }),
      track('c', 'done', { title: 'T' }),
      track('d', 'processing', { title: 'T', artist: 'A' }),
    ]
    const gate = convertGate(tracks, ['title', 'artist'], [], null, true)
    expect(gate.ready.map((t) => t.id)).toEqual(['a', 'b'])
    expect(gate.missing).toEqual({ count: 1, fields: ['artist'] })
    expect(eligibleForBatch(tracks, ['title', 'artist'], [], true)).toEqual(['a', 'b'])
  })

  // Replace-vs-add is a question about a batch; a single track is never "mixed", and its
  // ambiguous match is handled where the single convert decides what to stamp.
  it('never calls a single track mixed', () => {
    const index = buildLibraryIndex([{ title: 'Sunrise', artist: 'Halo', persistentId: 'PID2' }])
    const gate = convertGate(
      [track('a', 'idle', { title: 'Sunrise', artist: 'Halo' })],
      ['title'],
      [],
      index,
    )
    expect(gate.ready.map((t) => t.id)).toEqual(['a'])
    expect(gate.mixed).toBe(false)
  })
})

describe('canProcessTrack', () => {
  // The keyboard shortcut and command palette must enforce the same gate as the
  // convert button, so a track with empty required fields can't slip through and
  // fail mid-process.
  it('allows converting an idle track whose required fields are filled', () => {
    expect(
      canProcessTrack(track('a', 'idle', { title: 'Gold', artist: 'Alex' }), ['title', 'artist']),
    ).toBe(true)
  })

  it('allows retrying a previously failed track', () => {
    expect(
      canProcessTrack(track('a', 'error', { title: 'Gold', artist: 'Alex' }), ['title', 'artist']),
    ).toBe(true)
  })

  it('blocks when a required field is empty', () => {
    expect(canProcessTrack(track('a', 'idle', { title: 'Gold' }), ['title', 'artist'])).toBe(false)
  })

  it('blocks tracks already done or currently processing', () => {
    expect(canProcessTrack(track('a', 'done', { title: 'x', artist: 'y' }), ['title'])).toBe(false)
    expect(canProcessTrack(track('a', 'processing', { title: 'x' }), ['title'])).toBe(false)
  })

  // A custom field marked required reads through the same resolution as the form: the
  // value the file carries counts, so a tagged track is not blocked by a field it fills.
  it('checks a required custom field against the value the file carries', () => {
    const fields = [{ key: 'vinylCondition', label: 'Estado del vinilo' }]
    const tagged = {
      ...track('a', 'idle', { title: 'x' }),
      foreignTags: [{ name: 'VINYLCONDITION', value: 'NM' }],
    }
    expect(canProcessTrack(tagged, ['title', 'vinylCondition'], fields)).toBe(true)
    expect(canProcessTrack(track('b', 'idle', { title: 'x' }), ['vinylCondition'], fields)).toBe(
      false,
    )
  })

  it('allows re-converting a done track edited since it was processed', () => {
    const stale = { ...track('a', 'done', { title: 'x', artist: 'y' }), processedSignature: 'old' }
    expect(canProcessTrack(stale, ['title', 'artist'])).toBe(true)
  })
})

describe('summarizeBatch', () => {
  // After a batch the user needs to know the outcome without scanning the list,
  // so the run is reduced to how many converted, were skipped and failed.
  it('counts converted and failed tracks', () => {
    expect(summarizeBatch(['converted', 'failed', 'converted'])).toEqual({
      converted: 2,
      skipped: 0,
      failed: 1,
    })
  })

  it('reports zero failures when every track converted', () => {
    expect(summarizeBatch(['converted', 'converted'])).toEqual({
      converted: 2,
      skipped: 0,
      failed: 0,
    })
  })

  // A skip past a file conflict is a deliberate no-op, not an error, so it must
  // not inflate the failure count the user reads as "something went wrong".
  it('counts a skipped track on its own, not as a failure', () => {
    expect(summarizeBatch(['converted', 'skipped', 'failed'])).toEqual({
      converted: 1,
      skipped: 1,
      failed: 1,
    })
  })
})

describe('a Serato track', () => {
  it('is never converted, since Serato would lose the track and its cues', () => {
    const serato = { ...track('s', 'idle'), fromSerato: true }
    expect(canProcessTrack(serato, [])).toBe(false)
  })

  it('is left out of a batch while the other tracks of the selection still convert', () => {
    const tracks = [{ ...track('s', 'idle'), fromSerato: true }, track('a', 'idle')]
    expect(eligibleForBatch(tracks, [])).toEqual(['a'])
  })

  it('leaves a rekordbox track converting as before', () => {
    expect(canProcessTrack({ ...track('r', 'idle'), fromRekordbox: true }, [])).toBe(true)
  })
})
