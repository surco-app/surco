import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import type { TrackMetadata } from '../shared/types'
import {
  buildSpectrum,
  convertArgs,
  coverArgs,
  cutoffFilter,
  formatMatchesInput,
  parseAstats,
  parseBands,
  parseLoudness,
  planConversion,
  previewWavArgs,
  propertiesFromProbe,
  tagsFromProbe,
} from './ffmpeg'

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

  it('inserts the normalization audio filter before the codec, ahead of -c:a', () => {
    const args = convertArgs(
      '/in.wav',
      '/o.aiff',
      'pcm_s16be',
      meta,
      undefined,
      undefined,
      'volume=3dB',
    )
    const af = args.indexOf('-af')
    expect(af).toBeGreaterThan(-1)
    expect(args[af + 1]).toBe('volume=3dB')
    // the filter must apply before the audio codec is selected
    expect(af).toBeLessThan(args.indexOf('-c:a'))
  })

  it('omits -af entirely when no filter is given, leaving a plain conversion', () => {
    expect(convertArgs('/in.wav', '/o.aiff', 'pcm_s16be', meta)).not.toContain('-af')
  })

  it('maps the cover as attached art only when a cover is provided', () => {
    expect(convertArgs('/in.wav', '/o.aiff', 'pcm_s16be', meta)).not.toContain('attached_pic')
    const withCover = convertArgs('/in.wav', '/o.aiff', 'pcm_s16be', meta, '/cover.jpg')
    expect(withCover).toContain('/cover.jpg')
    expect(withCover).toContain('attached_pic')
  })

  it('never embeds the cover into a WAV target, whose single-stream RIFF container makes ffmpeg abort with "WAVE files have exactly one stream" — the art reaches Apple Music via AppleScript instead', () => {
    const args = convertArgs('/in.flac', '/out.tmp.wav', 'pcm_s24le', meta, '/cover.jpg')
    expect(args).not.toContain('attached_pic')
    expect(args).not.toContain('/cover.jpg')
    expect(args).not.toContain('1:v')
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

  // Each test asserts about its own probe calls, so the shared spy must start clean —
  // otherwise a test that probes (e.g. the m4a case) leaks into a later "not called" check.
  beforeEach(() => probe.mockClear())

  it('stream-copies a source already in the target format', async () => {
    expect(await planConversion('/in.aiff', 'aiff', probe)).toEqual({ codec: 'copy', ext: '.aiff' })
    expect(await planConversion('/in.mp3', 'mp3', probe)).toEqual({ codec: 'copy', ext: '.mp3' })
    expect(await planConversion('/in.wav', 'wav', probe)).toEqual({ codec: 'copy', ext: '.wav' })
    expect(await planConversion('/in.flac', 'flac', probe)).toEqual({ codec: 'copy', ext: '.flac' })
    // copying never needs to inspect the stream
    expect(probe).not.toHaveBeenCalled()
  })

  it('never stream-copies when normalizing, since the gain filter must re-encode the samples', async () => {
    // Same-format sources that would normally copy must encode instead, or the
    // normalization would be silently dropped (a stream copy emits the source bytes).
    expect(await planConversion('/in.mp3', 'mp3', probe, true)).toEqual({
      codec: 'libmp3lame',
      bitrate: '320k',
      ext: '.mp3',
    })
    expect(await planConversion('/in.aiff', 'aiff', probe, true)).toEqual({
      codec: 'pcm_s24be',
      ext: '.aiff',
    })
    expect(await planConversion('/in.flac', 'flac', probe, true)).toEqual({
      codec: 'flac',
      ext: '.flac',
    })
  })

  it('transcodes an AAC/M4A source to every target instead of stream-copying', async () => {
    // AAC/ALAC in .m4a never matches an output format, so each target encodes (the lossless
    // ones still probe the decoded bit depth). This is what lets the app ingest m4a at all.
    expect(await planConversion('/in.m4a', 'mp3', probe)).toEqual({
      codec: 'libmp3lame',
      bitrate: '320k',
      ext: '.mp3',
    })
    expect(await planConversion('/in.m4a', 'flac', probe)).toEqual({ codec: 'flac', ext: '.flac' })
    expect(await planConversion('/in.m4a', 'wav', probe)).toEqual({
      codec: 'pcm_s24le',
      ext: '.wav',
    })
    expect(await planConversion('/in.m4a', 'aiff', probe)).toEqual({
      codec: 'pcm_s24be',
      ext: '.aiff',
    })
  })

  it('transcodes an Opus/Ogg source too rather than stream-copying', async () => {
    expect(await planConversion('/in.opus', 'flac', probe)).toEqual({ codec: 'flac', ext: '.flac' })
    expect(await planConversion('/in.ogg', 'aiff', probe)).toEqual({
      codec: 'pcm_s24be',
      ext: '.aiff',
    })
  })

  it('encodes a lossless source to FLAC without probing, since the flac codec preserves the source bit depth itself', async () => {
    // FLAC is losslessly compressed and derives its bit depth from the input,
    // so there is no endianness or PCM width to pick — unlike AIFF/WAV
    expect(await planConversion('/in.wav', 'flac', probe)).toEqual({ codec: 'flac', ext: '.flac' })
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

  it('probes the bit depth when encoding a lossless target to WAV, picking little-endian PCM', async () => {
    // WAV is lossless like AIFF and must preserve the exact bit depth, but its
    // PCM is little-endian (RIFF) where AIFF is big-endian — encoding a 24-bit
    // source as pcm_s24be inside a WAV would corrupt every sample
    expect(await planConversion('/in.flac', 'wav', probe)).toEqual({
      codec: 'pcm_s24le',
      ext: '.wav',
    })
    expect(probe).toHaveBeenCalledWith('/in.flac')
  })
})

describe('previewWavArgs', () => {
  it('re-encodes only the audio into the WAV the player can decode, with the given little-endian PCM codec', () => {
    // The <audio> element has no AIFF decoder, so an AIFF source is transcoded to
    // a temp WAV for playback. We keep just the audio (a stray cover stream would
    // make ffmpeg refuse the single-stream RIFF container) and re-encode the PCM
    // little-endian, since AIFF stores it big-endian and a stream copy would
    // corrupt every sample.
    const args = previewWavArgs('/in.aiff', '/out.wav', 'pcm_s24le')
    expect(args).toContain('/in.aiff')
    expect(args[args.length - 1]).toBe('/out.wav')
    const i = args.indexOf('-c:a')
    expect(args[i + 1]).toBe('pcm_s24le')
    expect(args).toContain('-map')
    expect(args[args.indexOf('-map') + 1]).toBe('0:a')
  })
})

describe('formatMatchesInput', () => {
  it('reports a match when the export format equals the source format, so it can be updated in place instead of copied out', () => {
    // This is the gate for editing the original file: exporting a WAV to WAV (or
    // MP3→MP3, etc.) only rewrites tags on a stream copy, so there is no reason to
    // spawn a second file in the output folder — we overwrite/rename the source.
    expect(formatMatchesInput('wav', '/in.wav')).toBe(true)
    expect(formatMatchesInput('mp3', '/in.mp3')).toBe(true)
    expect(formatMatchesInput('flac', '/in.flac')).toBe(true)
    expect(formatMatchesInput('aiff', '/in.aiff')).toBe(true)
  })

  it('matches case-insensitively and accepts the .aif alias for AIFF', () => {
    // Sources arrive with whatever case the muxer wrote, and AIFF rips use both
    // .aif and .aiff — all of these are the same format and must edit in place.
    expect(formatMatchesInput('wav', '/in.WAV')).toBe(true)
    expect(formatMatchesInput('aiff', '/in.aif')).toBe(true)
  })

  it('reports no match when the export format differs, so a real conversion writes a fresh file', () => {
    // WAV→MP3 re-encodes into a new container; the original is kept untouched and
    // the converted file lands in the output folder (it is not an in-place edit).
    expect(formatMatchesInput('mp3', '/in.wav')).toBe(false)
    expect(formatMatchesInput('wav', '/in.flac')).toBe(false)
    expect(formatMatchesInput('flac', '/in.aiff')).toBe(false)
  })
})

describe('cutoffFilter', () => {
  it('prints each band to stdout (file=-) tagged with its frequency, never to a filesystem path — so a Windows temp path (C:\\…, where ":" and "\\" are filtergraph metacharacters) can never reach the parser', () => {
    // Escaping a path inside file= is unreliable — ffmpeg still tries to evaluate
    // it ("Invalid argument"), which is what broke on Windows. Printing to stdout
    // removes paths from the filtergraph entirely; the surcoband tag is how
    // analyzeCutoff tells the merged bands apart.
    const filter = cutoffFilter([9000, 21000])
    expect(filter).toContain('ametadata=mode=add:key=surcoband:value=9000')
    expect(filter).toContain('ametadata=mode=add:key=surcoband:value=21000')
    expect(filter).toContain('ametadata=mode=print:file=-')
    expect(filter).not.toMatch(/file=(?!-)/)
  })

  it('splits the decode into one branch per band and mixes them back into a single output', () => {
    const filter = cutoffFilter([9000, 10000])
    expect(filter).toContain('asplit=2[b0][b1]')
    expect(filter).toContain('amix=inputs=2')
  })
})

describe('parseBands', () => {
  it('pairs each band frequency with its overall RMS from the tagged stdout', () => {
    // the filter prints the surcoband tag just before that band's Overall RMS;
    // per-channel rows (lavfi.astats.1.*) must be ignored, only Overall counts
    const out = [
      'frame:0 pts:0',
      'surcoband=9000',
      'lavfi.astats.1.RMS_level=-30.4',
      'lavfi.astats.Overall.RMS_level=-30.5',
      'frame:0 pts:0',
      'surcoband=21000',
      'lavfi.astats.Overall.RMS_level=-72.1',
    ].join('\n')
    const rms = parseBands(out)
    expect(rms.get(9000)).toBe(-30.5)
    expect(rms.get(21000)).toBe(-72.1)
  })

  it('keeps the last cumulative RMS when a band prints several frames, since reset=0 makes the final one the whole-file level', () => {
    const out = [
      'surcoband=9000',
      'lavfi.astats.Overall.RMS_level=-40.0',
      'surcoband=9000',
      'lavfi.astats.Overall.RMS_level=-31.2',
    ].join('\n')
    expect(parseBands(out).get(9000)).toBe(-31.2)
  })
})

describe('parseLoudness', () => {
  // A real ebur128=peak=true summary, printed to stderr at info level. The "LRA
  // low/high" lines and the per-section "Threshold" lines must not be mistaken for
  // the integrated I, the LRA, or the true peak we actually surface.
  const summary = [
    '[Parsed_ebur128_0 @ 0x600000] Summary:',
    '',
    '  Integrated loudness:',
    '    I:         -14.7 LUFS',
    '    Threshold: -25.0 LUFS',
    '',
    '  Loudness range:',
    '    LRA:         7.6 LU',
    '    Threshold: -35.0 LUFS',
    '    LRA low:   -19.2 LUFS',
    '    LRA high:  -11.6 LUFS',
    '',
    '  True peak:',
    '    Peak:       -0.5 dBFS',
  ].join('\n')

  it('reads integrated loudness, true peak and loudness range, ignoring the threshold and LRA low/high rows', () => {
    expect(parseLoudness(summary)).toEqual({
      integratedLufs: -14.7,
      truePeakDb: -0.5,
      lra: 7.6,
    })
  })

  it('maps a -inf integrated loudness or true peak (digital silence) to -Infinity so the UI can show it rather than NaN', () => {
    const silent = summary
      .replace('I:         -14.7 LUFS', 'I:         -inf LUFS')
      .replace('Peak:       -0.5 dBFS', 'Peak:       -inf dBFS')
    expect(parseLoudness(silent)).toEqual({
      integratedLufs: -Infinity,
      truePeakDb: -Infinity,
      lra: 7.6,
    })
  })

  it('returns null when the summary is absent (e.g. ffmpeg failed before measuring) so the caller hides the readout instead of inventing zeros', () => {
    expect(parseLoudness('ffmpeg version 7.0\nsome unrelated error\n')).toBeNull()
  })

  it('reads the final Summary, not the per-frame log: at t≈0 ebur128 prints the -70 LUFS gate floor and 0.0 LU, which would brand a loud track as near-silent', () => {
    // Real shape: a stream of per-frame lines (each with its own I:/LRA:) followed
    // by the Summary. The bug was matching the first I: (the gate floor) instead.
    const withFrames = [
      '[Parsed_ebur128_0 @ 0x1] t: 0.1  TARGET:-23 LUFS  M:-120.7 S:-120.7  I: -70.0 LUFS  LRA: 0.0 LU  TPK: 2.5 1.4 dBFS',
      '[Parsed_ebur128_0 @ 0x1] t: 0.4  TARGET:-23 LUFS  M:  -5.2 S:-120.7  I:  -5.2 LUFS  LRA: 0.0 LU  TPK: 2.5 1.7 dBFS',
      summary
        .replace('I:         -14.7 LUFS', 'I:          -6.2 LUFS')
        .replace('LRA:         7.6 LU', 'LRA:         5.2 LU')
        .replace('Peak:       -0.5 dBFS', 'Peak:        2.5 dBFS'),
    ].join('\n')
    expect(parseLoudness(withFrames)).toEqual({
      integratedLufs: -6.2,
      truePeakDb: 2.5,
      lra: 5.2,
    })
  })
})

describe('parseAstats', () => {
  // astats prints a per-channel block then an Overall block; each line carries a
  // "[Parsed_astats_0 @ ...] " prefix the parser must strip. Channel RMS gives the
  // L/R balance; the Overall DC offset flags a biased capture.
  const stats = [
    '[Parsed_astats_0 @ 0x1] Channel: 1',
    '[Parsed_astats_0 @ 0x1] DC offset: 0.000035',
    '[Parsed_astats_0 @ 0x1] RMS level dB: -15.933728',
    '[Parsed_astats_0 @ 0x1] Channel: 2',
    '[Parsed_astats_0 @ 0x1] DC offset: 0.000026',
    '[Parsed_astats_0 @ 0x1] RMS level dB: -16.689935',
    '[Parsed_astats_0 @ 0x1] Overall',
    '[Parsed_astats_0 @ 0x1] DC offset: 0.000040',
    '[Parsed_astats_0 @ 0x1] Peak level dB: -0.154044',
    '[Parsed_astats_0 @ 0x1] RMS level dB: -16.295393',
    '[Parsed_astats_0 @ 0x1] Noise floor dB: -45.202488',
  ].join('\n')

  it('derives balance from per-channel RMS, and DC/crest/noise floor from the Overall block', () => {
    const r = parseAstats(stats)
    expect(r?.balanceDb).toBeCloseTo(0.756, 2)
    expect(r?.dcOffset).toBeCloseTo(0.00004, 5)
    // crest = Overall peak − Overall RMS = -0.154 − (-16.295)
    expect(r?.crestDb).toBeCloseTo(16.141, 2)
    expect(r?.noiseFloorDb).toBeCloseTo(-45.2, 1)
  })

  it('reports a null balance for mono, where there is no second channel to compare', () => {
    const mono = [
      '[Parsed_astats_0 @ 0x1] Channel: 1',
      '[Parsed_astats_0 @ 0x1] DC offset: 0.001',
      '[Parsed_astats_0 @ 0x1] RMS level dB: -14.0',
      '[Parsed_astats_0 @ 0x1] Overall',
      '[Parsed_astats_0 @ 0x1] DC offset: 0.001',
      '[Parsed_astats_0 @ 0x1] RMS level dB: -14.0',
    ].join('\n')
    expect(parseAstats(mono)?.balanceDb).toBeNull()
  })

  it('takes the absolute DC offset, since a negative bias is just as wrong as a positive one', () => {
    const negative = stats.replace('DC offset: 0.000040', 'DC offset: -0.030000')
    expect(parseAstats(negative)?.dcOffset).toBeCloseTo(0.03, 4)
  })

  // The reported AIFF bug: a dead channel reads "-inf" and DC prints "nan", which
  // used to surface as "−∞ dB" and "NaN%". Both must be dropped to null and hidden.
  it('drops non-finite readings (a silent channel reading -inf, a nan DC offset) instead of showing −∞/NaN', () => {
    const broken = [
      '[Parsed_astats_0 @ 0x1] Channel: 1',
      '[Parsed_astats_0 @ 0x1] RMS level dB: -14.0',
      '[Parsed_astats_0 @ 0x1] Channel: 2',
      '[Parsed_astats_0 @ 0x1] RMS level dB: -inf',
      '[Parsed_astats_0 @ 0x1] Overall',
      '[Parsed_astats_0 @ 0x1] DC offset: nan',
      '[Parsed_astats_0 @ 0x1] RMS level dB: -14.0',
    ].join('\n')
    const r = parseAstats(broken)
    expect(r?.balanceDb).toBeNull()
    expect(r?.dcOffset).toBeNull()
  })

  it('returns null when no astats block is present so the caller hides the checks', () => {
    expect(parseAstats('ffmpeg version 7.0\n')).toBeNull()
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
          DISCOGS_RELEASE_ID: '123456',
          RATING: 'traktor@native-instruments.de|204|0',
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
      discogsReleaseId: '123456',
      rating: '4',
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

  it('ignores tags on the attached-picture stream', () => {
    // FLAC exposes the embedded art's "Cover (front)" description as a comment tag on
    // the picture (video) stream; reading it would stamp every track with a bogus
    // comment whenever it carries cover art.
    const m = tagsFromProbe({
      format: { tags: { title: 'Snap Ya Fingaz' } },
      streams: [
        { codec_type: 'audio' },
        { codec_type: 'video', tags: { comment: 'Cover (front)' } },
      ],
    })
    expect(m.title).toBe('Snap Ya Fingaz')
    expect(m.comment).toBe('')
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
      discogsReleaseId: '',
      rating: '',
    })
  })
})

describe('propertiesFromProbe', () => {
  const file = { sizeBytes: 58_400_000, createdMs: 1_700_000_000_000, modifiedMs: 1_700_000_500_000 }

  it('maps a 16-bit stereo WAV stream and container into display properties', () => {
    const p = propertiesFromProbe(
      {
        streams: [
          {
            codec_name: 'pcm_s16le',
            bits_per_raw_sample: '16',
            sample_rate: '44100',
            channels: 2,
          },
        ],
        format: { format_name: 'wav', bit_rate: '1411200', size: '58400000' },
      },
      file,
    )
    expect(p).toEqual({
      codec: 'pcm_s16le',
      container: 'wav',
      sampleRateHz: 44100,
      bitDepth: 16,
      channels: 2,
      bitrateKbps: 1411,
      sizeBytes: 58_400_000,
      createdMs: 1_700_000_000_000,
      modifiedMs: 1_700_000_500_000,
    })
  })

  it('reports a null bit depth for lossy streams that omit bits_per_raw_sample', () => {
    // MP3/AAC have no fixed sample size, so ffprobe leaves the field out; the UI then
    // hides the bit-depth row rather than inventing a "0 Bit" reading.
    const p = propertiesFromProbe(
      { streams: [{ codec_name: 'mp3', sample_rate: '44100', channels: 2 }], format: {} },
      file,
    )
    expect(p.bitDepth).toBeNull()
  })

  it('keeps only the first name when the container reports an alias list', () => {
    // ffprobe prints comma-joined names for multi-format demuxers (e.g. "aiff" alone
    // but "mov,mp4,m4a,..." for MP4); we show the primary one.
    const p = propertiesFromProbe(
      { streams: [{ codec_name: 'alac' }], format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' } },
      file,
    )
    expect(p.container).toBe('mov')
  })

  it('falls back to the stream bitrate when the container omits one, else null', () => {
    const fromStream = propertiesFromProbe(
      { streams: [{ bit_rate: '320000' }], format: {} },
      file,
    )
    expect(fromStream.bitrateKbps).toBe(320)
    const none = propertiesFromProbe({ streams: [{}], format: {} }, file)
    expect(none.bitrateKbps).toBeNull()
  })

  it('takes file size and timestamps from the filesystem stat, not the container', () => {
    const p = propertiesFromProbe(
      { streams: [{}], format: { size: '999' } },
      { sizeBytes: 58_400_000, createdMs: 1_700_000_000_000, modifiedMs: 1_700_000_500_000 },
    )
    expect(p.sizeBytes).toBe(58_400_000)
    expect(p.createdMs).toBe(1_700_000_000_000)
    expect(p.modifiedMs).toBe(1_700_000_500_000)
  })
})

describe('buildSpectrum', () => {
  const deps = (over: Record<string, unknown> = {}) => ({
    probe: vi.fn(async () => ({ sampleRate: '44100' })),
    spectrogram: vi.fn(async () => 'data:image/png;base64,AAAA'),
    cutoff: vi.fn(async () => 18000),
    ...over,
  })

  it('returns the image, measured cutoff and sample rate when everything succeeds', async () => {
    const res = await buildSpectrum('/in.flac', deps())
    expect(res.image).toBe('data:image/png;base64,AAAA')
    expect(res.cutoffHz).toBe(18000)
    expect(res.sampleRateHz).toBe(44100)
    expect(res.cutoffError).toBeUndefined()
  })

  it('still returns the image, with a null cutoff, when cutoff analysis fails', async () => {
    // The cutoff pass is a fragile per-band filtergraph that writes and re-reads
    // temp files and has repeatedly broken on Windows. Its failure must never blank
    // a spectrogram image that generated fine — that is the whole point of decoupling
    // them; otherwise one Promise.all rejection hides the image the user came to see.
    // The cutoff comes back null (not a guessed value) so the UI hides the verdict.
    const boom = new Error('ffmpeg filtergraph: Invalid argument')
    const res = await buildSpectrum(
      '/in.flac',
      deps({
        cutoff: vi.fn(async () => {
          throw boom
        }),
      }),
    )
    expect(res.image).toBe('data:image/png;base64,AAAA')
    expect(res.cutoffHz).toBeNull()
    expect(res.cutoffError).toBe(boom)
  })

  it('rejects when the image itself cannot be generated, since there is nothing to show', async () => {
    const boom = new Error('showspectrumpic failed')
    await expect(
      buildSpectrum(
        '/in.flac',
        deps({
          spectrogram: vi.fn(async () => {
            throw boom
          }),
        }),
      ),
    ).rejects.toBe(boom)
  })
})
