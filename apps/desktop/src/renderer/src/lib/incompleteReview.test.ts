import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackMetadata } from '../../../shared/types'
import { type IncompleteInput, incompleteFindings } from './incompleteReview'

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
