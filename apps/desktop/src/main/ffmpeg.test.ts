import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import type { TrackMetadata } from '../shared/types'
import {
  buildSpectrum,
  convertArgs,
  convertTmpPath,
  coverArgs,
  coverFilter,
  cutoffFilter,
  formatMatchesInput,
  parseAstats,
  parseBands,
  parseLoudness,
  planConversion,
  previewWavArgs,
  propertiesFromProbe,
  stripPictureArgs,
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

describe('convertTmpPath', () => {
  // Bulk conversions run several jobs in parallel; two tracks resolving to the same
  // output name must never share a temp file, or their ffmpeg processes interleave
  // writes into one path and a corrupted file lands as a "successful" conversion.
  it('gives every call its own temp path for the same output', () => {
    expect(convertTmpPath('/out/song.aiff', '.aiff')).not.toBe(
      convertTmpPath('/out/song.aiff', '.aiff'),
    )
  })

  // The rename over the final output is only atomic within one volume, and ffmpeg
  // picks its muxer from the target's extension — so the temp must stay in the
  // output's own directory and keep the real extension last. Dot-prefixed so
  // Finder, Surco's own folder watcher and any other app watching the output
  // folder (rekordbox auto-import) never see the half-written file at all.
  it('stays beside the output, hidden, and keeps the extension last', () => {
    const tmp = convertTmpPath('/out/song.aiff', '.aiff')
    expect(tmp).toMatch(/^\/out\/\.song\.tmp-[0-9a-f]+\.aiff$/)
  })

  it('matches the extension case-insensitively, like planConversion input handling', () => {
    expect(convertTmpPath('/out/song.AIFF', '.aiff')).toMatch(/\.AIFF$/i)
    expect(convertTmpPath('/out/song.AIFF', '.aiff')).toContain('.tmp-')
  })
})

describe('convertArgs', () => {
  it('writes to the given (temp) target, not straight to the final output', () => {
    // we always render to a temp file and rename it over the destination, so
    // re-processing an AIFF in place can never read and write the same path
    const args = convertArgs('/in.wav', '/out.tmp.aiff', { codec: 'pcm_s24be' }, meta)
    expect(args[args.length - 1]).toBe('/out.tmp.aiff')
    expect(args).toContain('/in.wav')
  })

  it('passes through a stream-copy codec so an AIFF input is not re-encoded', () => {
    const args = convertArgs('/in.aiff', '/out.tmp.aiff', { codec: 'copy' }, meta)
    const i = args.indexOf('-c:a')
    expect(args[i + 1]).toBe('copy')
  })

  it('inserts the normalization audio filter before the codec, ahead of -c:a', () => {
    const args = convertArgs(
      '/in.wav',
      '/o.aiff',
      { codec: 'pcm_s16be' },
      meta,
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
    expect(convertArgs('/in.wav', '/o.aiff', { codec: 'pcm_s16be' }, meta)).not.toContain('-af')
  })

  it('maps the cover as attached art only when a cover is provided', () => {
    expect(convertArgs('/in.wav', '/o.aiff', { codec: 'pcm_s16be' }, meta)).not.toContain('attached_pic')
    const withCover = convertArgs('/in.wav', '/o.aiff', { codec: 'pcm_s16be' }, meta, '/cover.jpg')
    expect(withCover).toContain('/cover.jpg')
    expect(withCover).toContain('attached_pic')
  })

  it('never embeds the cover into a WAV target, whose single-stream RIFF container makes ffmpeg abort with "WAVE files have exactly one stream" — the art reaches Apple Music via AppleScript instead', () => {
    const args = convertArgs('/in.flac', '/out.tmp.wav', { codec: 'pcm_s24le' }, meta, '/cover.jpg')
    expect(args).not.toContain('attached_pic')
    expect(args).not.toContain('/cover.jpg')
    expect(args).not.toContain('1:v')
  })

  it('writes the advanced tags to the ID3 frames the DJ tools and Music read', () => {
    // verified against ffmpeg: these keys land in real TBPM/TKEY/TPUB/TPOS/TPE4
    // frames and the de-facto TXXX:CATALOGNUMBER, all re-readable by ffprobe
    const args = convertArgs('/in.wav', '/o.mp3', { codec: 'pcm_s16be' }, {
      ...meta,
      bpm: '128',
      key: '8A',
      publisher: 'Kontor',
      catalogNumber: 'KON123',
      discNumber: '2',
      remixArtist: 'Airscape',
      composer: 'André Tanneberger',
      isrc: 'DEA449900124',
      mixName: 'Club Mix',
      originalYear: '1998',
    })
    expect(args).toContain('TBPM=128')
    expect(args).toContain('TKEY=8A')
    expect(args).toContain('publisher=Kontor')
    expect(args).toContain('CATALOGNUMBER=KON123')
    expect(args).toContain('disc=2')
    expect(args).toContain('TPE4=Airscape')
    expect(args).toContain('composer=André Tanneberger')
    expect(args).toContain('TSRC=DEA449900124')
    expect(args).toContain('TIT3=Club Mix')
    // TORY, not TDOR: the conversion pins ID3v2.3, where TDOR does not exist
    expect(args).toContain('TORY=1998')
  })

  it('writes the compilation flag ffmpeg maps to the TCMP frame iTunes reads', () => {
    const id3 = convertArgs('/in.wav', '/o.mp3', { codec: 'pcm_s16be' }, { ...meta, compilation: '1' })
    expect(id3).toContain('compilation=1')
    const flac = convertArgs('/in.wav', '/o.flac', { codec: 'flac' }, { ...meta, compilation: '1' })
    expect(flac).toContain('COMPILATION=1')
  })

  it('writes the Vorbis comment names into a FLAC target, where the ID3 frame ids would be opaque', () => {
    // verified against ffmpeg: the FLAC muxer has no ID3 mapping and writes the
    // keys verbatim, so TKEY/TBPM/TPE4 would land as comments Traktor and Mixed
    // In Key never look for — they read INITIALKEY/BPM/REMIXER in FLAC
    const args = convertArgs('/in.wav', '/o.flac', { codec: 'flac' }, {
      ...meta,
      bpm: '128',
      key: '8A',
      remixArtist: 'Airscape',
      isrc: 'DEA449900124',
      mixName: 'Club Mix',
      originalYear: '1998',
    })
    expect(args).toContain('INITIALKEY=8A')
    expect(args).toContain('BPM=128')
    expect(args).toContain('REMIXER=Airscape')
    expect(args).toContain('ISRC=DEA449900124')
    expect(args).toContain('SUBTITLE=Club Mix')
    expect(args).toContain('ORIGINALYEAR=1998')
    expect(
      args.some(
        (a) =>
          a.startsWith('TKEY') ||
          a.startsWith('TBPM') ||
          a.startsWith('TPE4') ||
          a.startsWith('TSRC') ||
          a.startsWith('TIT3') ||
          a.startsWith('TORY'),
      ),
    ).toBe(false)
  })

  it('writes a blank managed field as an empty tag so a re-encode clears the source value instead of inheriting it', () => {
    // ffmpeg copies the source's global metadata into the re-encoded file by
    // default (no -map_metadata needed), so a field the user emptied in the
    // editor must be overridden with an empty tag — otherwise the original
    // comment/BPM/etc. resurfaces. Covers both a generic key (comment) and a
    // raw frame name (TBPM), which clear the carried-over value alike.
    const args = convertArgs('/in.wav', '/o.mp3', { codec: 'pcm_s16be' }, { ...meta, comment: '', bpm: '' })
    expect(args).toContain('comment=')
    expect(args).toContain('TBPM=')
  })

  it('clears the FLAC RATING comment when the rating field is empty', () => {
    // FLAC is the one format whose rating round-trips through ffprobe, so an empty
    // field at convert time means the file had none or the user erased it — either
    // way writing the empty tag (which deletes it) is safe, and it is what makes
    // "Empty every metadata field" actually empty the rating too.
    const args = convertArgs('/in.flac', '/o.flac', { codec: 'copy' }, { ...meta, rating: '' })
    expect(args).toContain('RATING=')
    // A set rating still writes the Traktor POPM string, not the empty clear.
    const rated = convertArgs('/in.flac', '/o.flac', { codec: 'copy' }, { ...meta, rating: '4' })
    expect(rated).toContain('RATING=traktor@native-instruments.de|204|0')
    expect(rated).not.toContain('RATING=')
    // Non-FLAC targets keep their POPM handling in the TagLib pass; no Vorbis tag.
    const mp3 = convertArgs('/in.flac', '/o.mp3', { codec: 'copy' }, { ...meta, rating: '' })
    expect(mp3.some((a) => a.startsWith('RATING'))).toBe(false)
  })

  it('marks the output bitexact so the muxer writes no ENCODER=Lavf… tag', () => {
    // Verified against ffmpeg 6.1.1: without it every FLAC gains an ENCODER Vorbis
    // comment and every MP3 a TSSE frame; with it both disappear while the MP3
    // Info/LAME gapless header stays intact. Must sit after the input, where it
    // acts as an output option.
    const args = convertArgs('/in.wav', '/o.flac', { codec: 'flac' }, meta)
    const i = args.indexOf('-fflags')
    expect(i).toBeGreaterThan(args.indexOf('/in.wav'))
    expect(args[i + 1]).toBe('+bitexact')
  })

  it('clears the alias spellings other taggers use, so stale LABEL/ORGANIZATION/ALBUMARTIST2 comments stop shadowing the fields Surco writes', () => {
    // The reader falls back to these aliases, so a leftover LABEL from a previous
    // tagger resurfaced in the editor even after the user emptied the field — and
    // other apps showed the field twice (their PUBLISHER next to ours).
    const args = convertArgs('/in.flac', '/o.flac', { codec: 'copy' }, { ...meta, publisher: 'Kontor' })
    expect(args).toContain('publisher=Kontor')
    expect(args).toContain('label=')
    expect(args).toContain('organization=')
    expect(args).toContain('albumartist2=')
    expect(args).toContain('labelno=')
    expect(args).toContain('tracknum=')
    expect(args).toContain('year=')
  })

  it('never emits a clearing entry for the key it just wrote', () => {
    // The alias list contains the written name's own spelling (it is also a read
    // alias); clearing it would wipe the value in the same command.
    const flac = convertArgs('/in.wav', '/o.flac', { codec: 'flac' }, { ...meta, bpm: '128', compilation: '1' })
    expect(flac).toContain('BPM=128')
    expect(flac).not.toContain('bpm=')
    expect(flac).toContain('COMPILATION=1')
    expect(flac).not.toContain('compilation=')
    const mp3 = convertArgs('/in.wav', '/o.mp3', { codec: 'libmp3lame', bitrate: '320k' }, { ...meta, bpm: '128' })
    expect(mp3).toContain('TBPM=128')
    expect(mp3).not.toContain('tbpm=')
  })

  it('sets the audio bitrate right after the codec when one is given', () => {
    // an MP3 encode needs an explicit bitrate; a stream-copy must not carry one
    const args = convertArgs('/in.wav', '/o.mp3', { codec: 'libmp3lame', bitrate: '320k' }, meta)
    const i = args.indexOf('-c:a')
    expect(args.slice(i, i + 4)).toEqual(['-c:a', 'libmp3lame', '-b:a', '320k'])
    expect(convertArgs('/in.mp3', '/o.mp3', { codec: 'copy' }, meta)).not.toContain('-b:a')
  })
})

describe('convertArgs for an M4A target', () => {
  // The mp4 muxer has no ID3 to version-pin, and the cover/covr atom is written by the
  // TagLib finishing pass — embedding it here too would be redundant (and the flags
  // meaningless), so both stay off the ffmpeg command line for .m4a outputs.
  it('skips the ID3 flags and the cover embed', () => {
    const args = convertArgs('/in.flac', '/out.tmp.m4a', { codec: 'alac' }, meta, '/cover.jpg')
    expect(args).not.toContain('-write_id3v2')
    expect(args).not.toContain('attached_pic')
    expect(args).toContain('alac')
  })

  it('passes the LAME VBR level as -q:a when the plan carries one', () => {
    const args = convertArgs('/in.wav', '/o.mp3', { codec: 'libmp3lame', quality: '0' }, meta)
    expect(args).toContain('-q:a')
    expect(args).toContain('0')
    expect(args).not.toContain('-b:a')
  })

  it('emits the encoder-shaping flags (-sample_fmt, -ar, -compression_level) right after the codec', () => {
    // -sample_fmt is what pins FLAC/ALAC to the source width (the 16→24 fix): without
    // it, a float filter chain makes the encoder pick its widest input format.
    const args = convertArgs(
      '/in.wav',
      '/o.flac',
      { codec: 'flac', sampleFmt: 's16', sampleRateHz: 44100, compressionLevel: '8' },
      meta,
    )
    const i = args.indexOf('-c:a')
    expect(args.slice(i, i + 8)).toEqual([
      '-c:a',
      'flac',
      '-sample_fmt',
      's16',
      '-ar',
      '44100',
      '-compression_level',
      '8',
    ])
    expect(convertArgs('/in.aiff', '/o.aiff', { codec: 'copy' }, meta)).not.toContain('-sample_fmt')
  })
})

describe('planConversion', () => {
  const probe = vi.fn(async () => ({
    codecName: 'flac',
    sampleFmt: 's32',
    bitsPerRawSample: 24,
    sampleRate: '44100',
    channels: 2,
  }))
  const probe16 = vi.fn(async () => ({
    codecName: 'flac',
    sampleFmt: 's16',
    bitsPerRawSample: 16,
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

  // ALAC never stream-copies even from an .m4a source: the container can hold lossy
  // AAC, and telling the two apart would need a codec probe — while an ALAC re-encode
  // is lossless regardless. The probe pins the encoder to the source width so a float
  // decode (or filter) can never widen it.
  it('always encodes an ALAC target, even from an .m4a source, pinned to the source width', async () => {
    expect(await planConversion('/in.m4a', 'alac', probe)).toEqual({
      codec: 'alac',
      sampleFmt: 's32p',
      ext: '.m4a',
    })
    expect(await planConversion('/in.flac', 'alac', probe16)).toEqual({
      codec: 'alac',
      sampleFmt: 's16p',
      ext: '.m4a',
    })
  })

  // The MP3 quality setting swaps the fixed 320 CBR for LAME's V0 VBR — but a source
  // already in MP3 still stream-copies: re-encoding lossy-to-lossy only degrades it.
  it('plans V0 VBR when asked, without breaking the MP3 stream-copy shortcut', async () => {
    expect(await planConversion('/in.wav', 'mp3', probe, false, { mp3Quality: 'v0' })).toEqual({
      codec: 'libmp3lame',
      quality: '0',
      ext: '.mp3',
    })
    expect(await planConversion('/in.mp3', 'mp3', probe, false, { mp3Quality: 'v0' })).toEqual({
      codec: 'copy',
      ext: '.mp3',
    })
  })

  it('maps every MP3 quality choice onto its LAME flags', async () => {
    for (const [choice, bitrate] of [
      ['256', '256k'],
      ['192', '192k'],
      ['160', '160k'],
      ['128', '128k'],
    ] as const) {
      expect(await planConversion('/in.wav', 'mp3', probe, false, { mp3Quality: choice })).toEqual({
        codec: 'libmp3lame',
        bitrate,
        ext: '.mp3',
      })
    }
    expect(await planConversion('/in.wav', 'mp3', probe, false, { mp3Quality: 'v2' })).toEqual({
      codec: 'libmp3lame',
      quality: '2',
      ext: '.mp3',
    })
  })

  // Djotas' case: a same-format source (96/24 FLAC → FLAC) is a metadata-only
  // update BY DESIGN, even with pins set — the quality knobs never silently
  // re-encode what looks like "already converted". The explicit per-track
  // "Re-encode" action passes forceReencode, and only then do the pins apply.
  it('keeps the same-format copy shortcut even when quality pins are set', async () => {
    const probe96 = vi.fn(async () => ({
      codecName: 'flac',
      sampleFmt: 's32',
      bitsPerRawSample: 24,
      sampleRate: '96000',
      channels: 2,
    }))
    expect(
      await planConversion('/in.flac', 'flac', probe96, false, { sampleRate: '48000' }),
    ).toEqual({ codec: 'copy', ext: '.flac' })
    expect(probe96).not.toHaveBeenCalled()
  })

  it('re-encodes a same-format source when the explicit force flag is set, applying the pins', async () => {
    const probe96 = vi.fn(async () => ({
      codecName: 'flac',
      sampleFmt: 's32',
      bitsPerRawSample: 24,
      sampleRate: '96000',
      channels: 2,
    }))
    expect(
      await planConversion('/in.flac', 'flac', probe96, false, { sampleRate: '48000' }, true),
    ).toEqual({
      codec: 'flac',
      sampleFmt: 's32',
      compressionLevel: '5',
      sampleRateHz: 48000,
      ext: '.flac',
    })
    expect(
      await planConversion('/in.wav', 'wav', probe96, false, { bitDepth: '16' }, true),
    ).toEqual({
      codec: 'pcm_s16le',
      dither: true,
      ext: '.wav',
    })
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
      sampleFmt: 's32',
      compressionLevel: '5',
      ext: '.flac',
    })
  })

  // The reported 16→24 bug: loudnorm/volume filters hand the encoder float samples,
  // and an unpinned FLAC/ALAC encoder then picks its widest input format (24-bit).
  // Pinning -sample_fmt to the probed source width keeps a 44.1/16 rip at 16 bits,
  // and the reduction back from the float chain gets TPDF dither.
  it('keeps a 16-bit source at 16 bits when normalizing to FLAC/ALAC', async () => {
    expect(await planConversion('/in.flac', 'flac', probe16, true)).toEqual({
      codec: 'flac',
      sampleFmt: 's16',
      compressionLevel: '5',
      dither: true,
      ext: '.flac',
    })
    expect(await planConversion('/in.wav', 'alac', probe16, true)).toEqual({
      codec: 'alac',
      sampleFmt: 's16p',
      dither: true,
      ext: '.m4a',
    })
  })

  // A lossy decoder emits float as an artifact of decoding, not as source precision.
  // Rendering it as 32-bit float WAV/AIFF bloats the file and CDJs refuse float WAV,
  // so lossy sources land on 24-bit integer PCM — the widest depth DJ gear plays.
  it('renders a lossy decode as 24-bit integer PCM, never 32-bit float', async () => {
    const lossy = vi.fn(async () => ({
      codecName: 'mp3float',
      sampleFmt: 'fltp',
      bitsPerRawSample: 0,
      sampleRate: '44100',
      channels: 2,
    }))
    expect(await planConversion('/in.mp3', 'wav', lossy)).toEqual({
      codec: 'pcm_s24le',
      ext: '.wav',
    })
    expect(await planConversion('/in.mp3', 'aiff', lossy)).toEqual({
      codec: 'pcm_s24be',
      ext: '.aiff',
    })
    expect(await planConversion('/in.mp3', 'flac', lossy)).toEqual({
      codec: 'flac',
      sampleFmt: 's32',
      compressionLevel: '5',
      ext: '.flac',
    })
  })

  // Unlike a lossy decode, a genuine float PCM source (field recorder, DAW bounce)
  // really holds float precision — converting it behind the user's back would lose data.
  it('preserves a genuine float PCM source as 32-bit float', async () => {
    const f32 = vi.fn(async () => ({
      codecName: 'pcm_f32le',
      sampleFmt: 'flt',
      bitsPerRawSample: 0,
      sampleRate: '48000',
      channels: 2,
    }))
    expect(await planConversion('/in.wav', 'aiff', f32)).toEqual({
      codec: 'pcm_f32be',
      ext: '.aiff',
    })
  })

  it('pins the output bit depth when the settings ask for one, dithering only reductions to 16', async () => {
    expect(await planConversion('/in.flac', 'wav', probe, false, { bitDepth: '16' })).toEqual({
      codec: 'pcm_s16le',
      dither: true,
      ext: '.wav',
    })
    // Pinning 24 on a 16-bit source pads (the user's explicit ask) — nothing to dither.
    expect(await planConversion('/in.wav', 'flac', probe16, false, { bitDepth: '24' })).toEqual({
      codec: 'flac',
      sampleFmt: 's32',
      compressionLevel: '5',
      ext: '.flac',
    })
    // 16→16 with no filter passes the samples through untouched: dither would only add noise.
    expect(await planConversion('/in.wav', 'flac', probe16, false, { bitDepth: '16' })).toEqual({
      codec: 'flac',
      sampleFmt: 's16',
      compressionLevel: '5',
      ext: '.flac',
    })
  })

  it('resamples only when the pinned rate differs from the source, dithering the 16-bit requantization', async () => {
    const probe48 = vi.fn(async () => ({
      codecName: 'flac',
      sampleFmt: 's16',
      bitsPerRawSample: 16,
      sampleRate: '48000',
      channels: 2,
    }))
    expect(
      await planConversion('/in.flac', 'wav', probe48, false, { sampleRate: '44100' }),
    ).toEqual({
      codec: 'pcm_s16le',
      sampleRateHz: 44100,
      dither: true,
      ext: '.wav',
    })
    // Already at the pinned rate → no resample, no dither.
    expect(
      await planConversion('/in.flac', 'wav', probe48, false, { sampleRate: '48000' }),
    ).toEqual({
      codec: 'pcm_s16le',
      ext: '.wav',
    })
    // MP3 needs the probe only to compare rates; the encoder itself never cares about depth.
    expect(await planConversion('/in.wav', 'mp3', probe48, false, { sampleRate: '44100' })).toEqual({
      codec: 'libmp3lame',
      bitrate: '320k',
      sampleRateHz: 44100,
      ext: '.mp3',
    })
  })

  it('passes the chosen FLAC compression level through — a size/speed trade-off, never a quality one', async () => {
    expect(await planConversion('/in.wav', 'flac', probe, false, { flacCompression: '8' })).toEqual({
      codec: 'flac',
      sampleFmt: 's32',
      compressionLevel: '8',
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
    expect(await planConversion('/in.m4a', 'flac', probe)).toEqual({
      codec: 'flac',
      sampleFmt: 's32',
      compressionLevel: '5',
      ext: '.flac',
    })
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
    expect(await planConversion('/in.opus', 'flac', probe)).toEqual({
      codec: 'flac',
      sampleFmt: 's32',
      compressionLevel: '5',
      ext: '.flac',
    })
    expect(await planConversion('/in.ogg', 'aiff', probe)).toEqual({
      codec: 'pcm_s24be',
      ext: '.aiff',
    })
  })

  it('probes the source when encoding FLAC, pinning the encoder to the source width', async () => {
    // The flac encoder would otherwise derive its width from whatever the decode/filter
    // chain hands it — float in the normalize/lossy cases — silently widening 16→24.
    expect(await planConversion('/in.wav', 'flac', probe)).toEqual({
      codec: 'flac',
      sampleFmt: 's32',
      compressionLevel: '5',
      ext: '.flac',
    })
    expect(probe).toHaveBeenCalledWith('/in.wav')
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

describe('coverFilter', () => {
  it('shrinks oversized art without ever enlarging by default', () => {
    // The min() clamp is what keeps a 500px Discogs cover at 500px: blowing it up
    // would invent pixels the user didn't ask for.
    const vf = coverFilter({ maxSize: 1200, square: false, upscale: false })
    expect(vf).toBe("scale='min(1200,iw)':'min(1200,ih)':force_original_aspect_ratio=decrease")
  })

  it('scales smaller art up to the target when upscale is on', () => {
    // The opt-in for uniform library art (700×700 on every deck/grid): small covers
    // are enlarged to the box, lanczos keeping the blow-up as clean as it can be.
    const vf = coverFilter({ maxSize: 700, square: false, upscale: true })
    expect(vf).toBe('scale=700:700:force_original_aspect_ratio=decrease:flags=lanczos')
  })

  it('center-crops to square before scaling, so square+upscale lands exactly on target×target', () => {
    const vf = coverFilter({ maxSize: 700, square: true, upscale: true })
    expect(vf).toBe(
      "crop='min(iw,ih)':'min(iw,ih)',scale=700:700:force_original_aspect_ratio=decrease:flags=lanczos",
    )
  })

  it('ignores upscale when no size limit is set, since there is no target to reach', () => {
    // maxSize 0 means "no limit", which internally caps at 4000 — upscaling to that
    // sentinel would quintuple most covers for nothing.
    const vf = coverFilter({ maxSize: 0, square: false, upscale: true })
    expect(vf).toBe("scale='min(4000,iw)':'min(4000,ih)':force_original_aspect_ratio=decrease")
  })
})

describe('stripPictureArgs', () => {
  it('stream-copies only the audio into a new FLAC, dropping the malformed embedded art Chromium chokes on', () => {
    // A FLAC whose PICTURE block has an empty MIME type makes the <audio> demuxer
    // refuse the whole file. Re-muxing audio-only (a lossless stream copy, so it's
    // instant and bit-identical) leaves a file the player can decode.
    const args = stripPictureArgs('/in.flac', '/out.flac')
    expect(args).toContain('/in.flac')
    expect(args[args.length - 1]).toBe('/out.flac')
    expect(args[args.indexOf('-map') + 1]).toBe('0:a')
    expect(args[args.indexOf('-c:a') + 1]).toBe('copy')
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
    const filter = cutoffFilter([
      { freqHz: 9000, widthHz: 1000 },
      { freqHz: 21000, widthHz: 1000 },
    ])
    expect(filter).toContain('ametadata=mode=add:key=surcoband:value=9000x1000')
    expect(filter).toContain('ametadata=mode=add:key=surcoband:value=21000x1000')
    expect(filter).toContain('ametadata=mode=print:file=-')
    expect(filter).not.toMatch(/file=(?!-)/)
  })

  it('splits the decode into one branch per band and mixes them back into a single output', () => {
    const filter = cutoffFilter([
      { freqHz: 9000, widthHz: 1000 },
      { freqHz: 10000, widthHz: 1000 },
    ])
    expect(filter).toContain('asplit=2[b0][b1]')
    expect(filter).toContain('amix=inputs=2')
  })

  it('keeps coarse and fine probes at the same centre frequency apart via the width tag', () => {
    // 13 kHz is probed twice — once with the 1 kHz cutoff band and once with the
    // 500 Hz roughness band. Without the width in the tag, one overwrites the other.
    const filter = cutoffFilter([
      { freqHz: 13000, widthHz: 1000 },
      { freqHz: 13000, widthHz: 500 },
    ])
    expect(filter).toContain('value=13000x1000')
    expect(filter).toContain('value=13000x500')
  })
})

describe('parseBands', () => {
  it('pairs each band tag with its overall RMS from the tagged stdout', () => {
    // the filter prints the surcoband tag just before that band's Overall RMS;
    // per-channel rows (lavfi.astats.1.*) must be ignored, only Overall counts
    const out = [
      'frame:0 pts:0',
      'surcoband=9000x1000',
      'lavfi.astats.1.RMS_level=-30.4',
      'lavfi.astats.Overall.RMS_level=-30.5',
      'frame:0 pts:0',
      'surcoband=21000x1000',
      'lavfi.astats.Overall.RMS_level=-72.1',
    ].join('\n')
    const rms = parseBands(out)
    expect(rms.get('9000x1000')).toBe(-30.5)
    expect(rms.get('21000x1000')).toBe(-72.1)
  })

  it('keeps the last cumulative RMS when a band prints several frames, since reset=0 makes the final one the whole-file level', () => {
    const out = [
      'surcoband=9000x1000',
      'lavfi.astats.Overall.RMS_level=-40.0',
      'surcoband=9000x1000',
      'lavfi.astats.Overall.RMS_level=-31.2',
    ].join('\n')
    expect(parseBands(out).get('9000x1000')).toBe(-31.2)
  })

  it('keeps the coarse and fine readings of the same centre frequency separate', () => {
    const out = [
      'surcoband=13000x1000',
      'lavfi.astats.Overall.RMS_level=-33.7',
      'surcoband=13000x500',
      'lavfi.astats.Overall.RMS_level=-38.6',
    ].join('\n')
    const rms = parseBands(out)
    expect(rms.get('13000x1000')).toBe(-33.7)
    expect(rms.get('13000x500')).toBe(-38.6)
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
    expect(args).not.toContain('-vf')
  })

  // The renderer keeps the import-time extract for the whole session, so it must be a
  // bounded thumbnail — a 3000px JPEG per row adds up to hundreds of MB on a big
  // crate. The cap keeps the aspect ratio and never upscales smaller art.
  it('caps the extracted picture to a thumbnail when a max size is given', () => {
    const args = coverArgs('/in.flac', '/out.jpg', 512)
    const i = args.indexOf('-vf')
    expect(args[i + 1]).toBe(
      "scale='min(512,iw)':'min(512,ih)':force_original_aspect_ratio=decrease",
    )
    expect(args[args.length - 1]).toBe('/out.jpg')
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
          composer: 'André Tanneberger',
          TSRC: 'DEA449900124',
          TIT3: 'Club Mix',
          TORY: '1998',
          MOOD: 'Dark',
          ENERGY: '4',
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
      composer: 'André Tanneberger',
      isrc: 'DEA449900124',
      mixName: 'Club Mix',
      originalYear: '1998',
      compilation: '',
      mood: 'Dark',
      energy: '4',
    })
  })

  it('reads the Vorbis comment names a FLAC export carries', () => {
    // the same fields under their FLAC names must land in the same metadata keys
    const m = tagsFromProbe({
      format: {
        tags: {
          COMPOSER: 'André Tanneberger',
          ISRC: 'DEA449900124',
          SUBTITLE: 'Club Mix',
          ORIGINALYEAR: '1998',
        },
      },
    })
    expect(m.composer).toBe('André Tanneberger')
    expect(m.isrc).toBe('DEA449900124')
    expect(m.mixName).toBe('Club Mix')
    expect(m.originalYear).toBe('1998')
  })

  it('reads the label/catalog/track spellings legacy taggers wrote as fallbacks', () => {
    // Real-world FLACs arrive with LABELNO/ALBUMARTIST2/TRACKNUM comments from older
    // taggers; reading them keeps the editor from showing blank fields for data the
    // file plainly carries (and the writer clears these same keys).
    const m = tagsFromProbe({
      format: {
        tags: { LABELNO: 'KON123', ALBUMARTIST2: 'ATB', TRACKNUM: '7' },
      },
    })
    expect(m.catalogNumber).toBe('KON123')
    expect(m.albumArtist).toBe('ATB')
    expect(m.trackNumber).toBe('7')
  })

  // TAG_FIELDS documents "first non-empty wins" for a field's alias list (year's is
  // ['date', 'year'], date first). A file passed between two taggers over its life can
  // carry a blanked-out DATE comment left by one of them alongside a real YEAR value
  // from another — the higher-priority alias existing-but-empty must not shadow real
  // data sitting in the fallback.
  it('skips an empty higher-priority alias and falls through to a non-empty fallback', () => {
    const m = tagsFromProbe({ format: { tags: { DATE: '', YEAR: '1999' } } })
    expect(m.year).toBe('1999')
  })

  // The inverse must still hold: when the higher-priority alias actually has data,
  // it wins over the fallback even if that fallback exists too.
  it('still prefers the higher-priority alias when both are present', () => {
    const m = tagsFromProbe({ format: { tags: { DATE: '2001', YEAR: '1999' } } })
    expect(m.year).toBe('2001')
  })

  it('reads the compilation flag as set only when the tag is a literal 1', () => {
    // iTunes writes TCMP=1 when set; a 0 (or junk) must read as unset so the
    // checkbox never shows ticked for a file that isn't a compilation
    expect(tagsFromProbe({ format: { tags: { TCMP: '1' } } }).compilation).toBe('1')
    expect(tagsFromProbe({ format: { tags: { compilation: '0' } } }).compilation).toBe('')
  })

  it('reads the energy tag verbatim, whatever scale wrote it', () => {
    // There is no one energy scale: Mixed In Key writes 1-10, other taggers 1-5, some a
    // word. Surco does not own this field — it carries it. Anything else would mean a
    // convert silently dropping the 8 a Mixed In Key user had already put there, which is
    // exactly the loss this field exists to stop.
    expect(tagsFromProbe({ format: { tags: { ENERGY: '4' } } }).energy).toBe('4')
    expect(tagsFromProbe({ format: { tags: { ENERGY: '8' } } }).energy).toBe('8')
    expect(tagsFromProbe({ format: { tags: { ENERGY: 'high' } } }).energy).toBe('high')
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
      composer: '',
      isrc: '',
      mixName: '',
      originalYear: '',
      compilation: '',
      mood: '',
      energy: '',
    })
  })
})

describe('propertiesFromProbe', () => {
  const file = {
    sizeBytes: 58_400_000,
    createdMs: 1_700_000_000_000,
    modifiedMs: 1_700_000_500_000,
  }

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
      tagFormats: [],
    })
  })

  it('carries the sniffed tag formats through onto the result', () => {
    const p = propertiesFromProbe({ streams: [{}], format: {} }, file, ['ID3v2.3', 'INFO'])
    expect(p.tagFormats).toEqual(['ID3v2.3', 'INFO'])
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
    const fromStream = propertiesFromProbe({ streams: [{ bit_rate: '320000' }], format: {} }, file)
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
    cutoff: vi.fn(async () => ({
      cutoffHz: 18000,
      processed: false,
      hasKnee: true,
      upsampled: false,
    })),
    shelf: vi.fn(async () => ({ shelfCutoffHz: null, kneeCutoffHz: null })),
    ...over,
  })

  it('returns the image, measured cutoff and sample rate when everything succeeds', async () => {
    const res = await buildSpectrum('/in.flac', deps())
    expect(res.image).toBe('data:image/png;base64,AAAA')
    expect(res.cutoffHz).toBe(18000)
    expect(res.sampleRateHz).toBe(44100)
    expect(res.processed).toBe(false)
    expect(res.hasKnee).toBe(true)
    expect(res.upsampled).toBe(false)
    expect(res.cutoffError).toBeUndefined()
  })

  it('carries the processed, knee and upsample flags through, so the verdict reads the real signals', async () => {
    const res = await buildSpectrum(
      '/in.flac',
      deps({
        cutoff: vi.fn(async () => ({
          cutoffHz: 16000,
          processed: true,
          hasKnee: false,
          upsampled: true,
        })),
      }),
    )
    expect(res.cutoffHz).toBe(16000)
    expect(res.processed).toBe(true)
    expect(res.hasKnee).toBe(false)
    expect(res.upsampled).toBe(true)
  })

  it('flags a flat HF shelf the codec pass missed, and draws the cutoff at the shelf elbow', async () => {
    // The codec pass sees a flat synthetic shelf as reaching Nyquist (good); the
    // shelf probe catches it and reports the real ceiling, which must win the verdict.
    const res = await buildSpectrum(
      '/in.flac',
      deps({
        cutoff: vi.fn(async () => ({
          cutoffHz: 22050,
          processed: false,
          hasKnee: false,
          upsampled: false,
        })),
        shelf: vi.fn(async () => ({ shelfCutoffHz: 16000, kneeCutoffHz: null })),
      }),
    )
    expect(res.processed).toBe(true)
    expect(res.cutoffHz).toBe(16000)
  })

  it('keeps the codec pass cutoff when it already found manipulation, even if a shelf is also seen', async () => {
    const res = await buildSpectrum(
      '/in.flac',
      deps({
        cutoff: vi.fn(async () => ({
          cutoffHz: 15000,
          processed: true,
          hasKnee: false,
          upsampled: false,
        })),
        shelf: vi.fn(async () => ({ shelfCutoffHz: 16000, kneeCutoffHz: null })),
      }),
    )
    expect(res.processed).toBe(true)
    expect(res.cutoffHz).toBe(15000)
  })

  it('flags a codec wall the biquad pass smeared below its knee, via the FFT knee', async () => {
    // The biquad pass reads the smeared wall as a knee-free taper extending to 18 kHz
    // (graded "Good"); the FFT knee catches the real wall and must turn hasKnee on and
    // pull the cutoff down to it, so the verdict grades the file "Bad".
    const res = await buildSpectrum(
      '/in.flac',
      deps({
        cutoff: vi.fn(async () => ({
          cutoffHz: 18000,
          processed: false,
          hasKnee: false,
          upsampled: false,
        })),
        shelf: vi.fn(async () => ({ shelfCutoffHz: null, kneeCutoffHz: 15000 })),
      }),
    )
    expect(res.processed).toBe(false)
    expect(res.hasKnee).toBe(true)
    expect(res.cutoffHz).toBe(15000)
  })

  it('ignores the FFT knee once a shelf already marked the file reprocessed', async () => {
    // A flat shelf is its own verdict (reprocessed); the FFT knee must not override the
    // shelf elbow or flip the file off the processed path.
    const res = await buildSpectrum(
      '/in.flac',
      deps({
        cutoff: vi.fn(async () => ({
          cutoffHz: 22050,
          processed: false,
          hasKnee: false,
          upsampled: false,
        })),
        shelf: vi.fn(async () => ({ shelfCutoffHz: 16000, kneeCutoffHz: 15000 })),
      }),
    )
    expect(res.processed).toBe(true)
    expect(res.hasKnee).toBe(false)
    expect(res.cutoffHz).toBe(16000)
  })

  it('still returns the image and codec verdict when the shelf probe fails', async () => {
    const boom = new Error('shelf decode failed')
    const res = await buildSpectrum(
      '/in.flac',
      deps({
        shelf: vi.fn(async () => {
          throw boom
        }),
      }),
    )
    expect(res.image).toBe('data:image/png;base64,AAAA')
    expect(res.cutoffHz).toBe(18000)
    expect(res.processed).toBe(false)
    expect(res.shelfError).toBe(boom)
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
    expect(res.processed).toBe(false)
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
