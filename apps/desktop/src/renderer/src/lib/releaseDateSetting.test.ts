import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { Release } from '../../../shared/types'
import type { TrackItem } from '../types'
import { trackSignature } from './dirty'
import { buildReleaseMeta } from './release'
import { followReleaseDate } from './releaseDateSetting'
import { hasStagedEdits } from './sessionEdits'

function row(readYear: string, over: Partial<TrackItem> = {}): TrackItem {
  const meta = { ...emptyMetadata(), title: 'T', year: readYear }
  return {
    id: 'a',
    inputPath: '/m/a.flac',
    fileName: 'a.flac',
    listLabel: 'T',
    query: '',
    status: 'idle',
    meta,
    diskSignature: trackSignature({ meta }),
    fileDate: '2020-12-01',
    ...over,
  }
}

// The setting promises to show and save the whole date whenever the file has one. It is read
// on every row, so turning it on or off must re-dress the rows already loaded, not only the
// next ones read: a row left on the old year wrote that year over the file on convert.
function matched(fullReleaseDate: boolean): TrackItem {
  const read = row(fullReleaseDate ? '2020-12-01' : '2020')
  const rel: Release = {
    provider: 'discogs',
    id: 1,
    title: 'Album',
    artists: [],
    tracklist: [],
    year: 1999,
    released: '1999-05-12',
  }
  const patch = buildReleaseMeta(read.meta, rel, undefined, {}, undefined, [], fullReleaseDate)
  return { ...read, meta: patch.meta, appliedRelease: patch.appliedRelease }
}

describe('followReleaseDate', () => {
  it('shows the whole date on a row read while the setting was off, without staging it', () => {
    const [next] = followReleaseDate([row('2020')], true)

    expect(next.meta.year).toBe('2020-12-01')
    expect(hasStagedEdits(next)).toBe(false)
  })

  it('goes back to the plain year once the setting is turned off', () => {
    const [next] = followReleaseDate([row('2020-12-01')], false)

    expect(next.meta.year).toBe('2020')
    expect(hasStagedEdits(next)).toBe(false)
  })

  // A year the user typed is theirs: the setting dresses the file's date, never a hand edit.
  it('leaves a year the user typed alone', () => {
    const read = row('2020')
    const [next] = followReleaseDate([{ ...read, meta: { ...read.meta, year: '1999' } }], true)

    expect(next.meta.year).toBe('1999')
    expect(hasStagedEdits(next)).toBe(true)
  })

  it('leaves a row whose file carries no whole date alone', () => {
    const plain = row('2020', { fileDate: undefined })

    expect(followReleaseDate([plain], true)[0]).toBe(plain)
  })

  // A year a catalog release wrote is the release's date, not a hand edit: applied with the
  // setting off it must still show the release's whole date once the setting is turned on.
  it('shows the whole date of a release applied while the setting was off', () => {
    const [next] = followReleaseDate([matched(false)], true)

    expect(next.meta.year).toBe('1999-05-12')
    expect(next.appliedRelease?.wrote.year).toBe('1999-05-12')
  })

  it('goes back to the release year once the setting is turned off', () => {
    const [next] = followReleaseDate([matched(true)], false)

    expect(next.meta.year).toBe('1999')
    expect(next.appliedRelease?.wrote.year).toBe('1999')
  })

  it('leaves a year the user typed over an applied release alone', () => {
    const applied = matched(false)
    const [next] = followReleaseDate(
      [{ ...applied, meta: { ...applied.meta, year: '2005' } }],
      true,
    )

    expect(next.meta.year).toBe('2005')
  })

  // Undoing the release must hand back the file's own date as the setting now shows it,
  // or the undo stages the old-format year and the next convert writes it over the file.
  it('undoes a release applied before the toggle to the file date in the new format', () => {
    const [next] = followReleaseDate([matched(false)], true)
    const undone = { ...next, meta: { ...next.meta, ...next.appliedRelease?.before } }

    expect(undone.meta.year).toBe('2020-12-01')
    expect(hasStagedEdits({ ...undone, appliedRelease: undefined })).toBe(false)
  })
})
