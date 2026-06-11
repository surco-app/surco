import { describe, expect, it } from 'vitest'
import { coverSourceOf } from './coverSource'

const base = { inputPath: '/m/a.flac' }

describe('coverSourceOf', () => {
  // The renderer's copy of embedded art is a display thumbnail; writing it into an
  // output file would permanently downscale the user's artwork. The job must name
  // the source file instead so main embeds the original at full resolution.
  it('names the source file when the shown cover is the file’s own art', () => {
    const thumb = 'data:image/jpeg;base64,thumb'
    expect(coverSourceOf({ ...base, coverUrl: thumb, embeddedCover: thumb })).toEqual({
      coverFromFile: '/m/a.flac',
    })
  })

  it('passes a Discogs URL through untouched', () => {
    const src = coverSourceOf({
      ...base,
      coverUrl: 'https://img.discogs.com/x.jpg',
      embeddedCover: 'data:image/jpeg;base64,thumb',
    })
    expect(src).toEqual({ coverUrl: 'https://img.discogs.com/x.jpg', coverPath: undefined })
  })

  it('passes a user-picked file through untouched', () => {
    const src = coverSourceOf({
      ...base,
      coverUrl: 'blob:abc',
      coverPath: '/pictures/cover.png',
      embeddedCover: 'data:image/jpeg;base64,thumb',
    })
    expect(src).toEqual({ coverUrl: 'blob:abc', coverPath: '/pictures/cover.png' })
  })

  it('sends nothing for a track with no cover', () => {
    expect(coverSourceOf(base)).toEqual({ coverUrl: undefined, coverPath: undefined })
  })
})
