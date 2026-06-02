import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import type { TrackMetadata } from '../shared/types'
import { convertArgs, coverArgs, cutoffFilter, planConversion, tagsFromProbe } from './ffmpeg'

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
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
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

  it('writes the advanced tags to the ID3 frames the DJ tools and Music read', () => {
    // verified against ffmpeg: these keys land in real TBPM/TKEY/TPUB/TPOS/TPE4
    // frames and the de-facto TXXX:CATALOGNUMBER, all re-readable by ffprobe
    const args = convertArgs('/in.wav', '/o.mp3', 'pcm_s16be', {
      ...meta,
      bpm: '128',
      key: '8A',
      publisher: 'Kontor',
      catalogNumber: 'KON123',
      discNumber: '2',
      remixArtist: 'Airscape',
    })
    expect(args).toContain('TBPM=128')
    expect(args).toContain('TKEY=8A')
    expect(args).toContain('publisher=Kontor')
    expect(args).toContain('CATALOGNUMBER=KON123')
    expect(args).toContain('disc=2')
    expect(args).toContain('TPE4=Airscape')
  })

  it('omits an advanced tag when it is blank', () => {
    const args = convertArgs('/in.wav', '/o.mp3', 'pcm_s16be', meta)
    expect(args.some((a) => a.startsWith('TBPM'))).toBe(false)
  })

  it('sets the audio bitrate right after the codec when one is given', () => {
    // an MP3 encode needs an explicit bitrate; a stream-copy must not carry one
    const args = convertArgs('/in.wav', '/o.mp3', 'libmp3lame', meta, undefined, '320k')
    const i = args.indexOf('-c:a')
    expect(args.slice(i, i + 4)).toEqual(['-c:a', 'libmp3lame', '-b:a', '320k'])
    expect(convertArgs('/in.mp3', '/o.mp3', 'copy', meta)).not.toContain('-b:a')
  })
})

describe('planConversion', () => {
  const probe = vi.fn(async () => ({
    sampleFmt: 's32',
    bitsPerRawSample: 24,
    sampleRate: '44100',
    channels: 2,
  }))

  it('stream-copies a source already in the target format', async () => {
    expect(await planConversion('/in.aiff', 'aiff', probe)).toEqual({ codec: 'copy', ext: '.aiff' })
    expect(await planConversion('/in.mp3', 'mp3', probe)).toEqual({ codec: 'copy', ext: '.mp3' })
    // copying never needs to inspect the stream
    expect(probe).not.toHaveBeenCalled()
  })

  it('encodes a lossless source to 320 kbps MP3 without probing the bit depth', async () => {
    // MP3 is fixed-rate lossy, so the source bit depth is irrelevant
    expect(await planConversion('/in.wav', 'mp3', probe)).toEqual({
      codec: 'libmp3lame',
      bitrate: '320k',
      ext: '.mp3',
    })
    expect(probe).not.toHaveBeenCalled()
  })

  it('probes the source bit depth when encoding a lossless target to AIFF', async () => {
    // AIFF must preserve the exact bit depth, which only ffprobe can reveal
    expect(await planConversion('/in.wav', 'aiff', probe)).toEqual({
      codec: 'pcm_s24be',
      ext: '.aiff',
    })
    expect(probe).toHaveBeenCalledWith('/in.wav')
  })
})

describe('cutoffFilter', () => {
  it('embeds bare filenames in file=, never absolute paths, so a Windows path (C:\\…, where ":" and "\\" are filtergraph metacharacters) can never reach the parser', () => {
    // Escaping a Windows path inside file= is unreliable — ffmpeg still tries to
    // evaluate it ("Invalid argument"). The fix is to pass a plain filename and
    // run ffmpeg with cwd set to the temp dir, so nothing here needs escaping.
    const filter = cutoffFilter([9000, 21000], ['surco-band-9000.txt', 'surco-band-21000.txt'])
    expect(filter).toContain('ametadata=mode=print:file=surco-band-9000.txt[o0]')
    expect(filter).toContain('ametadata=mode=print:file=surco-band-21000.txt[o1]')
  })

  it('splits the decode into one branch per band and mixes them back into a single output', () => {
    const filter = cutoffFilter([9000, 10000], ['a.txt', 'b.txt'])
    expect(filter).toContain('asplit=2[b0][b1]')
    expect(filter).toContain('amix=inputs=2')
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
          // advanced tags re-read from the frames we write: TBPM/TKEY/TPUB/TPOS/
          // TPE4 and the de-facto TXXX:CATALOGNUMBER
          TBPM: '138',
          TKEY: '8A',
          publisher: 'Kontor',
          CATALOGNUMBER: 'KON123',
          disc: '2',
          TPE4: 'Airscape',
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
      discNumber: '2',
      bpm: '138',
      key: '8A',
      publisher: 'Kontor',
      catalogNumber: 'KON123',
      remixArtist: 'Airscape',
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
      discNumber: '',
      bpm: '',
      key: '',
      publisher: '',
      catalogNumber: '',
      remixArtist: '',
    })
  })
})
