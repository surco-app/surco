import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { trackSignature } from './dirty'
import { type IncompleteInput, incompleteFindings, incompleteOfRows } from './incompleteReview'

const meta = (m: Partial<TrackMetadata>): TrackMetadata => ({ ...emptyMetadata(), ...m })

const row = (r: Partial<IncompleteInput> & { id: string }): IncompleteInput => ({
  disk: meta({ title: 'T', artist: 'A' }),
  shown: meta({ title: 'T', artist: 'A' }),
  fromName: {},
  ...r,
})

describe('incompleteFindings', () => {
  it('lists what the file lacks, not what the app shows, since the review writes the file', () => {
    const findings = incompleteFindings(
      [row({ id: 'a', shown: meta({ title: 'T', artist: 'A', genre: 'House' }) })],
      ['title', 'genre'],
    )
    expect(findings).toEqual([
      { id: 'a', fields: [{ field: 'genre', proposal: { value: 'House', source: 'shown' } }] },
    ])
  })

  it('leaves out a track whose file already holds every required field', () => {
    expect(incompleteFindings([row({ id: 'a' })], ['title', 'artist'])).toEqual([])
  })

  it('counts a field holding only spaces as missing', () => {
    const findings = incompleteFindings(
      [row({ id: 'a', disk: meta({ title: 'T', artist: '  ' }) })],
      ['artist'],
    )
    expect(findings[0].fields.map((f) => f.field)).toEqual(['artist'])
  })

  it('prefers the app value over a pending suggestion, and that over the file name', () => {
    const findings = incompleteFindings(
      [
        row({
          id: 'a',
          shown: meta({ title: 'T', artist: 'A', genre: 'Techno' }),
          suggested: meta({ genre: 'House', year: '1995-04-12', album: 'LP' }),
          fromName: { genre: 'Name', album: 'Name LP', grouping: 'Warm' },
        }),
      ],
      ['genre', 'year', 'album', 'grouping'],
    )
    expect(findings[0].fields).toEqual([
      { field: 'genre', proposal: { value: 'Techno', source: 'shown' } },
      { field: 'year', proposal: { value: '1995-04-12', source: 'suggested' } },
      { field: 'album', proposal: { value: 'LP', source: 'suggested' } },
      { field: 'grouping', proposal: { value: 'Warm', source: 'name' } },
    ])
  })

  it('keeps a missing field with no proposal so it can be filled by hand', () => {
    const findings = incompleteFindings([row({ id: 'a' })], ['album'])
    expect(findings).toEqual([{ id: 'a', fields: [{ field: 'album' }] }])
  })

  it('ignores required fields the review cannot write, which belong to the editor', () => {
    expect(incompleteFindings([row({ id: 'a' })], ['bpm', 'comment'])).toEqual([])
  })
})

const track = (t: Partial<TrackItem> & { inputPath: string }): TrackItem => {
  const base: TrackItem = {
    id: t.inputPath,
    fileName: 'Artist - Title',
    listLabel: '',
    query: '',
    status: 'idle',
    meta: meta({ title: 'T', artist: 'A' }),
    ...t,
  }
  return { diskSignature: trackSignature(base), ...base }
}

const deps = (required: string[], suggest?: (row: TrackItem) => TrackMetadata | undefined) => ({
  required: () => required,
  suggest: suggest ?? (() => undefined),
})

describe('incompleteOfRows', () => {
  it('reads the file side of each row and names it with the id the review writes by', () => {
    const rows = [
      track({ inputPath: '/a.mp3', musicPersistentId: 'P1' }),
      track({ inputPath: '/b.mp3' }),
    ]
    expect(incompleteOfRows(rows, (r) => r.musicPersistentId, [], deps(['album']))).toEqual([
      { id: 'P1', fields: [{ field: 'album' }] },
    ])
  })

  it('takes the proposal from a pending suggestion and from the file name', () => {
    const rows = [track({ inputPath: '/a.mp3', fileName: 'Lara - Song' })]
    const found = incompleteOfRows(
      rows,
      (r) => r.inputPath,
      [],
      deps(['year', 'grouping'], () => meta({ year: '1995' })),
    )
    expect(found[0].fields[0]).toEqual({
      field: 'year',
      proposal: { value: '1995', source: 'suggested' },
    })
    const named = incompleteOfRows(rows, (r) => r.inputPath, [], deps(['artist']))
    expect(named).toEqual([])
    const unnamed = track({ inputPath: '/c.mp3', fileName: 'Lara - Song' })
    unnamed.meta = meta({ title: 'T' })
    unnamed.diskSignature = trackSignature(unnamed)
    expect(incompleteOfRows([unnamed], (r) => r.inputPath, [], deps(['artist']))).toEqual([
      { id: '/c.mp3', fields: [{ field: 'artist', proposal: { value: 'Lara', source: 'name' } }] },
    ])
  })

  it('drops a field the review already wrote this session, before the rows catch up', () => {
    const rows = [track({ inputPath: '/a.mp3' })]
    const filled = [{ path: '/a.mp3', fields: { album: { from: '', to: 'LP' } } }]
    expect(incompleteOfRows(rows, (r) => r.inputPath, filled, deps(['album']))).toEqual([])
    const undone = [...filled, { path: '/a.mp3', fields: { album: { from: 'LP', to: '' } } }]
    expect(incompleteOfRows(rows, (r) => r.inputPath, undone, deps(['album']))).toHaveLength(1)
  })

  it('skips rows whose file was not read, as the rest of the review does', () => {
    const rows = [
      track({ inputPath: '/a.mp3', loadingMeta: true }),
      track({ inputPath: '/b.mp3', metaReadFailed: true }),
      track({ inputPath: '/c.mp3', status: 'processing' }),
      { ...track({ inputPath: '/d.mp3' }), diskSignature: undefined },
    ]
    expect(incompleteOfRows(rows, (r) => r.inputPath, [], deps(['album']))).toEqual([])
  })

  it('lists a file the list holds twice once', () => {
    const rows = [track({ inputPath: '/a.mp3' }), { ...track({ inputPath: '/a.mp3' }), id: 'x' }]
    expect(incompleteOfRows(rows, (r) => r.inputPath, [], deps(['album']))).toHaveLength(1)
  })
})
