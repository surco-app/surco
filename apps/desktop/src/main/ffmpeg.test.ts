import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import type { TrackMetadata } from '../shared/types'
import { convertArgs, coverArgs, tagsFromProbe } from './ffmpeg'

const meta: TrackMetadata = {
  title: 'Till I Come',
  artist: 'ATB',
  album: '',
  albumArtist: 'ATB',
  year: '',
  genre: '',
  grouping: '',
  comment: '',
  trackNumber: '',
}

describe('convertArgs', () => {
  it('writes to the given (temp) target, not straight to the final output', () => {
    // we always render to a temp file and rename it over the destination, so
    // re-processing an AIFF in place can never read and write the same path
    const args = convertArgs('/in.wav', '/out.tmp.aiff', 'pcm_s24be', meta)
    expect(args[args.length - 1]).toBe('/out.tmp.aiff')
    expect(args).toContain('/in.wav')
  })

  it('passes through a stream-copy codec so an AIFF input is not re-encoded', () => {
    const args = convertArgs('/in.aiff', '/out.tmp.aiff', 'copy', meta)
    const i = args.indexOf('-c:a')
    expect(args[i + 1]).toBe('copy')
  })

  it('maps the cover as attached art only when a cover is provided', () => {
    expect(convertArgs('/in.wav', '/o.aiff', 'pcm_s16be', meta)).not.toContain('attached_pic')
    const withCover = convertArgs('/in.wav', '/o.aiff', 'pcm_s16be', meta, '/cover.jpg')
    expect(withCover).toContain('/cover.jpg')
    expect(withCover).toContain('attached_pic')
  })
})

describe('coverArgs', () => {
  it('extracts the first embedded picture as a still image, dropping audio', () => {
    const args = coverArgs('/in.flac', '/out.jpg')
    expect(args).toContain('-an')
    expect(args).toContain('/in.flac')
    expect(args[args.length - 1]).toBe('/out.jpg')
    const i = args.indexOf('-map')
    expect(args[i + 1]).toBe('0:v:0')
  })
})

describe('tagsFromProbe', () => {
  it('reads every metadata field from the container format tags', () => {
    const m = tagsFromProbe({
      format: {
        tags: {
          title: 'Till I Come',
          artist: 'ATB',
          album: 'Movin Melodies',
          album_artist: 'ATB',
          date: '1999',
          genre: 'Trance',
          grouping: 'Set A',
          comment: 'vinyl rip',
          track: '3',
        },
      },
    })
    expect(m).toEqual({
      title: 'Till I Come',
      artist: 'ATB',
      album: 'Movin Melodies',
      albumArtist: 'ATB',
      year: '1999',
      genre: 'Trance',
      grouping: 'Set A',
      comment: 'vinyl rip',
      trackNumber: '3',
    })
  })

  it('matches tag keys case-insensitively across muxers', () => {
    // WAV/AIFF muxers emit upper- or mixed-case keys; the values must still land
    const m = tagsFromProbe({ format: { tags: { TITLE: 'X', Artist: 'Y', ALBUM_ARTIST: 'Z' } } })
    expect(m.title).toBe('X')
    expect(m.artist).toBe('Y')
    expect(m.albumArtist).toBe('Z')
  })

  it('keeps only the index when the track tag carries an "n/total" pair', () => {
    // zero-padding later strips non-digits, so a raw "3/12" would corrupt to "312"
    expect(tagsFromProbe({ format: { tags: { track: '3/12' } } }).trackNumber).toBe('3')
  })

  it('falls back to stream tags when the container carries none at format level', () => {
    const m = tagsFromProbe({ streams: [{ tags: { title: 'From Stream' } }] })
    expect(m.title).toBe('From Stream')
  })

  it('returns empty strings for every absent tag', () => {
    expect(tagsFromProbe({})).toEqual({
      title: '',
      artist: '',
      album: '',
      albumArtist: '',
      year: '',
      genre: '',
      grouping: '',
      comment: '',
      trackNumber: '',
    })
  })
})
