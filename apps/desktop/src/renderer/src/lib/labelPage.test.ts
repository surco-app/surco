import { describe, expect, it } from 'vitest'
import type { Release, TrackMetadata } from '../../../shared/types'
import { readLabelPage } from './labelPage'
import { buildReleaseMeta } from './release'

function labelSingle(over: Partial<Release> = {}): Release {
  return {
    provider: 'bandcamp',
    id: 7,
    title: 'Da Crew - Song (Original mix)',
    artists: [{ name: 'Label Traxx' }],
    tracklist: [{ position: '1', title: 'Da Crew - Song (Original mix)', duration: '6:12' }],
    ...over,
  }
}

const file = { title: 'Song (Original mix)', artist: 'Da Crew' } as TrackMetadata

describe('readLabelPage', () => {
  // A label's Bandcamp page names the label as its artist and keeps the real act inside the
  // track title. The file's own artist tag is what proves the "Da Crew - " prefix is an
  // artist and not part of the title, so applying the release must not write the label as
  // the artist nor repeat the prefix in Title and Album.
  it('writes the file artist, the bare title and the label when the title carries the file artist', () => {
    const rel = readLabelPage(labelSingle(), file.artist)
    const { meta } = buildReleaseMeta(file, rel, rel.tracklist[0])
    expect(meta.title).toBe('Song (Original mix)')
    expect(meta.artist).toBe('Da Crew')
    expect(meta.albumArtist).toBe('Da Crew')
    expect(meta.album).toBe('Song (Original mix)')
    expect(meta.publisher).toBe('Label Traxx')
  })

  it('reads the prefix with the same case and spacing tolerance the Bandcamp reader uses', () => {
    const rel = readLabelPage(
      labelSingle({ tracklist: [{ position: '1', title: 'DA  crew - Song (Original mix)' }] }),
      ' Da Crew ',
    )
    expect(rel.tracklist[0].title).toBe('Song (Original mix)')
  })

  // A label that already fills the release's label field knows its own name better than
  // the page header does.
  it('keeps the label the release already carries', () => {
    const rel = readLabelPage(
      labelSingle({ labels: [{ name: 'Traxx Records', catno: 'TRX001' }] }),
      'Da Crew',
    )
    expect(rel.labels).toEqual([{ name: 'Traxx Records', catno: 'TRX001' }])
  })

  // Without the file's artist nothing corroborates that the prefix is an artist, so the
  // release stays exactly as the source gave it.
  it('leaves the release untouched when the file has no artist', () => {
    const source = labelSingle()
    expect(readLabelPage(source, undefined)).toBe(source)
    expect(readLabelPage(source, '  ')).toBe(source)
  })

  // A dash inside a real title ("Closer - Precursor Mix") is part of the title.
  it('leaves a dashed title alone when it does not start with the file artist', () => {
    const source = labelSingle({
      title: 'Closer - Precursor Mix',
      tracklist: [{ position: '1', title: 'Closer - Precursor Mix' }],
    })
    expect(readLabelPage(source, 'Da Crew')).toBe(source)
  })

  // Discogs is curated: its artist and title fields are already right, so its releases
  // never go through this reading.
  it('never rewrites a Discogs release', () => {
    const source = labelSingle({ provider: 'discogs' })
    expect(readLabelPage(source, 'Da Crew')).toBe(source)
  })

  // When the page artist is already the file's artist, the prefix was the artist's own and
  // the Bandcamp reader already handled it; there is no label to move anywhere.
  it('leaves the release alone when the page artist already is the file artist', () => {
    const source = labelSingle({ artists: [{ name: 'Da Crew' }] })
    expect(readLabelPage(source, 'Da Crew')).toBe(source)
  })

  // On a label EP only the file artist's tracks are corroborated; another act's track keeps
  // what the page said, and the label is never written as the album artist.
  it('rewrites only the tracks the file artist names on a mixed release', () => {
    const rel = readLabelPage(
      labelSingle({
        title: 'Label Traxx Volume 1',
        tracklist: [
          { position: '1', title: 'Da Crew - Song (Original mix)' },
          { position: '2', title: 'Other Act - Tune' },
        ],
      }),
      'Da Crew',
    )
    expect(rel.tracklist[0]).toMatchObject({
      title: 'Song (Original mix)',
      artists: [{ name: 'Da Crew' }],
    })
    expect(rel.tracklist[1]).toEqual({ position: '2', title: 'Other Act - Tune' })
    expect(rel.title).toBe('Label Traxx Volume 1')
    expect(rel.artists).toEqual([])
    expect(rel.labels).toEqual([{ name: 'Label Traxx', catno: '' }])
  })
})
