import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackItem } from '../types'
import { trackSignature } from './dirty'
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
})
