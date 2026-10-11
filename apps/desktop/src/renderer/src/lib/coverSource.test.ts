import { describe, expect, it } from 'vitest'
import { coverSourceOf, keepCoverArg } from './coverSource'

describe('keepCoverArg', () => {
  // Applying a release match must never overwrite art the file already carries — the
  // release image is often smaller. keep is on exactly when there's a cover to protect.
  it('keeps the file’s own cover when it has one', () => {
    expect(keepCoverArg({ coverUrl: 'blob:abc', coverPath: '/p/cover.png' })).toEqual({
      url: 'blob:abc',
      path: '/p/cover.png',
      keep: true,
    })
  })

  // With no cover to protect, keep is off so buildReleaseMeta fills from the release.
  it('lets the release fill in when the file has no cover', () => {
    expect(keepCoverArg({ coverUrl: undefined, coverPath: undefined })).toEqual({
      url: undefined,
      path: undefined,
      keep: false,
    })
  })
})

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

  // Music's artwork for a file that carries none rides in as both the shown cover and the
  // row's embedded one, with the picture itself in coverPath. Read as the file's own art,
  // the job asked the coverless file for a cover and the copy came out without any: the
  // playlist recipe's promise that the cover Music holds is taken was broken on convert.
  it('embeds the cover Music holds for a file that has none of its own', () => {
    const fromMusic = 'surco://cover/abc.jpg'
    expect(
      coverSourceOf({
        ...base,
        coverUrl: fromMusic,
        embeddedCover: fromMusic,
        coverPath: '/userData/applemusic-artwork/ID.jpg',
      }),
    ).toEqual({ coverUrl: fromMusic, coverPath: '/userData/applemusic-artwork/ID.jpg' })
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
