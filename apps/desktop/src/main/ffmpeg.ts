import { execFile } from 'node:child_process'
import { readFile, rename, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { OutputFormat, TrackMetadata } from '../shared/types'
import { ffmpegPath, ffprobePath } from './binaries'
import { BAND_WIDTH_HZ, bandFrequencies, detectCutoff } from './cutoff'
import { tmpName } from './tmp'

const run = promisify(execFile)

interface ProbeTags {
  format?: { tags?: Record<string, unknown> }
  streams?: { tags?: Record<string, unknown> }[]
}

// Maps an ffprobe tag dump onto our metadata fields so a freshly loaded track
// arrives pre-filled. Tags live under format.tags for WAV/FLAC/AIFF (and
// stream.tags for some containers); keys vary in case across muxers, so we match
// case-insensitively and accept the common aliases each writer uses.
export function tagsFromProbe(data: ProbeTags): TrackMetadata {
  const sources: Record<string, unknown>[] = [
    data.format?.tags,
    ...(data.streams ?? []).map((s) => s.tags),
  ].filter((t): t is Record<string, unknown> => Boolean(t))
  const pick = (...names: string[]): string => {
    for (const tags of sources) {
      for (const [key, value] of Object.entries(tags)) {
        if (names.includes(key.toLowerCase())) return String(value ?? '').trim()
      }
    }
    return ''
  }
  return {
    title: pick('title'),
    artist: pick('artist'),
    album: pick('album'),
    albumArtist: pick('album_artist', 'albumartist', 'album artist'),
    year: pick('date', 'year'),
    genre: pick('genre'),
    grouping: pick('grouping', 'content_group'),
    comment: pick('comment'),
    // A "3/12" track tag would survive zero-padding as "312", so drop the total.
    trackNumber: pick('track', 'tracknumber').split('/')[0].trim(),
    discNumber: pick('disc', 'tpos', 'disc_number', 'discnumber').split('/')[0].trim(),
    bpm: pick('tbpm', 'bpm'),
    key: pick('tkey', 'initial_key', 'initialkey'),
    publisher: pick('publisher', 'tpub', 'label', 'organization'),
    catalogNumber: pick('catalognumber', 'catalog_number', 'catalogue', 'catalog'),
    remixArtist: pick('tpe4', 'remixer', 'remixed_by', 'remixedby', 'remix_artist'),
  }
}

export async function readTags(input: string): Promise<TrackMetadata> {
  const { stdout } = await run(ffprobePath, [
    '-v',
    'error',
    '-show_entries',
    'format_tags:stream_tags',
    '-of',
    'json',
    input,
  ])
  return tagsFromProbe(JSON.parse(stdout))
}

// Pulls the first embedded picture out as a still image (no audio), letting the
// .jpg target drive the encoder so PNG art is transcoded too. ffmpeg exits
// non-zero when the file carries no attached picture.
export function coverArgs(input: string, output: string): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    input,
    '-an',
    '-map',
    '0:v:0',
    '-frames:v',
    '1',
    output,
  ]
}

export async function extractCover(input: string): Promise<string | null> {
  const out = join(tmpdir(), tmpName('cover', 'jpg'))
  try {
    await run(ffmpegPath, coverArgs(input, out))
    const buf = await readFile(out)
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  } catch {
    return null
  } finally {
    await unlink(out).catch(() => {})
  }
}

interface ProbeResult {
  sampleFmt: string
  bitsPerRawSample: number
  sampleRate: string
  channels: number
}

export async function probeAudio(input: string): Promise<ProbeResult> {
  const { stdout } = await run(ffprobePath, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=sample_fmt,bits_per_raw_sample,sample_rate,channels',
    '-of',
    'json',
    input,
  ])
  const stream = JSON.parse(stdout).streams?.[0] ?? {}
  return {
    sampleFmt: stream.sample_fmt ?? 's16',
    bitsPerRawSample: Number(stream.bits_per_raw_sample) || 0,
    sampleRate: String(stream.sample_rate ?? ''),
    channels: Number(stream.channels) || 2,
  }
}

// Picks a PCM codec that preserves the source bit depth exactly (lossless),
// never downsampling. Endianness differs by container: AIFF stores big-endian
// samples, WAV (RIFF) little-endian, so the caller passes the one its target
// needs — using the wrong endianness corrupts every sample.
function pcmCodec(probe: ProbeResult, endian: 'be' | 'le'): string {
  if (probe.sampleFmt.startsWith('f')) return `pcm_f32${endian}`
  const bits =
    probe.bitsPerRawSample ||
    (probe.sampleFmt.includes('32') ? 32 : probe.sampleFmt.includes('16') ? 16 : 24)
  if (bits >= 32) return `pcm_s32${endian}`
  if (bits >= 24) return `pcm_s24${endian}`
  return `pcm_s16${endian}`
}

function metadataArgs(meta: TrackMetadata): string[] {
  const pairs: [string, string][] = [
    ['title', meta.title],
    ['artist', meta.artist],
    ['album', meta.album],
    ['album_artist', meta.albumArtist],
    ['date', meta.year],
    ['genre', meta.genre],
    ['grouping', meta.grouping],
    ['comment', meta.comment],
    ['track', meta.trackNumber],
    // ffmpeg maps these to the real ID3 frames DJ software and Music read:
    // disc→TPOS, publisher→TPUB, and the raw frame ids TBPM/TKEY/TPE4; the
    // catalog number has no standard frame so it rides the de-facto TXXX one.
    ['disc', meta.discNumber],
    ['TBPM', meta.bpm],
    ['TKEY', meta.key],
    ['TPE4', meta.remixArtist],
    ['publisher', meta.publisher],
    ['CATALOGNUMBER', meta.catalogNumber],
  ]
  return pairs.filter(([, v]) => v?.trim()).flatMap(([k, v]) => ['-metadata', `${k}=${v}`])
}

const AIFF_INPUT = /\.aiff?$/i
const MP3_INPUT = /\.mp3$/i
const WAV_INPUT = /\.wav$/i
const MP3_BITRATE = '320k'

export function convertArgs(
  input: string,
  output: string,
  codec: string,
  meta: TrackMetadata,
  coverPath?: string,
  bitrate?: string,
): string[] {
  // WAV is a single-stream RIFF container, so ffmpeg refuses to mux an attached
  // picture into it ("WAVE files have exactly one stream"). The cover still
  // reaches Apple Music via AppleScript, so a WAV target simply skips the embed.
  const embedCover = coverPath && !WAV_INPUT.test(output) ? coverPath : undefined
  const args = ['-y', '-i', input]
  if (embedCover) args.push('-i', embedCover)

  args.push('-map', '0:a')
  if (embedCover) args.push('-map', '1:v', '-c:v', 'copy', '-disposition:v:0', 'attached_pic')

  args.push('-c:a', codec)
  if (bitrate) args.push('-b:a', bitrate)
  args.push('-write_id3v2', '1', '-id3v2_version', '3')
  args.push(...metadataArgs(meta))
  args.push(output)
  return args
}

export interface ConversionPlan {
  codec: string
  bitrate?: string
  ext: '.aiff' | '.mp3' | '.wav'
}

// Decides how to render a source into the chosen output format. A source
// already in the target format is bit-identical, so it stream-copies (instant);
// otherwise it encodes — lossless to bit-depth-preserving PCM for AIFF/WAV
// (big-endian for AIFF, little-endian for WAV), or to a fixed 320 kbps for MP3.
// The bit depth only matters for the lossless targets, so MP3 skips the probe.
export async function planConversion(
  input: string,
  format: OutputFormat,
  probe: (input: string) => Promise<ProbeResult>,
): Promise<ConversionPlan> {
  if (format === 'mp3') {
    if (MP3_INPUT.test(input)) return { codec: 'copy', ext: '.mp3' }
    return { codec: 'libmp3lame', bitrate: MP3_BITRATE, ext: '.mp3' }
  }
  if (format === 'wav') {
    if (WAV_INPUT.test(input)) return { codec: 'copy', ext: '.wav' }
    return { codec: pcmCodec(await probe(input), 'le'), ext: '.wav' }
  }
  if (AIFF_INPUT.test(input)) return { codec: 'copy', ext: '.aiff' }
  return { codec: pcmCodec(await probe(input), 'be'), ext: '.aiff' }
}

export async function convertAudio(
  input: string,
  output: string,
  format: OutputFormat,
  meta: TrackMetadata,
  coverPath?: string,
): Promise<void> {
  // We always write to a temp file and rename it over the target, so
  // re-processing a file that already lives in the output folder (input path ===
  // output path) overwrites it atomically instead of failing with ffmpeg's
  // "Output same as Input" error.
  const { codec, bitrate, ext } = await planConversion(input, format, probeAudio)
  const tmp = output.replace(new RegExp(`\\${ext}$`, 'i'), `.tmp${ext}`)

  try {
    await run(ffmpegPath, convertArgs(input, tmp, codec, meta, coverPath, bitrate), {
      maxBuffer: 1024 * 1024 * 32,
    })
    await rename(tmp, output)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
}

export async function generateSpectrogram(input: string): Promise<string> {
  const out = join(tmpdir(), tmpName('spec', 'png'))
  try {
    await run(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      input,
      '-lavfi',
      'showspectrumpic=s=1000x280:legend=0:color=intensity:gain=2',
      out,
    ])
    const buf = await readFile(out)
    return `data:image/png;base64,${buf.toString('base64')}`
  } finally {
    await unlink(out).catch(() => {})
  }
}

export async function processCover(
  input: string,
  opts: { maxSize: number; square: boolean },
): Promise<string> {
  const max = opts.maxSize > 0 ? opts.maxSize : 4000
  const scale = `scale='min(${max},iw)':'min(${max},ih)':force_original_aspect_ratio=decrease`
  const vf = opts.square ? `crop='min(iw,ih)':'min(iw,ih)',${scale}` : scale
  const out = join(tmpdir(), tmpName('cover-proc', 'jpg'))
  await run(ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    input,
    '-vf',
    vf,
    '-q:v',
    '2',
    out,
  ])
  return out
}

// Builds the single-decode filtergraph that splits the audio into one
// bandpass→astats branch per band, prints each band's running stats to its own
// file, then mixes the branches so ffmpeg has a single output to render.
//
// The entries are bare filenames, never absolute paths: ffmpeg's filtergraph
// parser reads ':' as an option separator and '\' as an escape, so a Windows
// path like C:\Users\...\x.txt inside file= is unparseable (no escaping is
// reliable). analyzeCutoff runs ffmpeg with cwd set to the temp dir so these
// resolve there.
export function cutoffFilter(freqs: number[], names: string[]): string {
  const branches = freqs
    .map(
      (f, i) =>
        `[b${i}]bandpass=f=${f}:width_type=h:w=${BAND_WIDTH_HZ},astats=metadata=1:reset=0,` +
        `ametadata=mode=print:file=${names[i]}[o${i}]`,
    )
    .join(';')
  return (
    `[0:a]asetnsamples=n=1048576:p=0,asplit=${freqs.length}${freqs.map((_, i) => `[b${i}]`).join('')};` +
    `${branches};${freqs.map((_, i) => `[o${i}]`).join('')}amix=inputs=${freqs.length}`
  )
}

// Measures the energy in each high-frequency band in a single decode (asplit
// into one bandpass→astats branch per band) and hands the per-band RMS to
// detectCutoff, which spots the codec's brick wall. The cumulative astats RMS is
// printed once per (large) frame, so the last value in each file is the band's
// whole-file level.
export async function analyzeCutoff(input: string, sampleRateHz: number): Promise<number> {
  const nyquist = sampleRateHz / 2
  const freqs = bandFrequencies(nyquist)
  if (freqs.length < 2) return nyquist

  const dir = tmpdir()
  const names = freqs.map((f) => tmpName(`band-${f}`, 'txt'))
  const filter = cutoffFilter(freqs, names)

  try {
    await run(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        input,
        '-filter_complex',
        filter,
        '-f',
        'null',
        '-',
      ],
      // cwd is the temp dir so the filter can reference bare filenames; an
      // absolute path inside file= breaks ffmpeg's filtergraph parser on Windows.
      { cwd: dir, maxBuffer: 1024 * 1024 * 16 },
    )
    const bands = await Promise.all(
      freqs.map(async (freqHz, i) => {
        const text = await readFile(join(dir, names[i]), 'utf-8').catch(() => '')
        const matches = [...text.matchAll(/RMS_level=(-?[\d.]+)/g)]
        return {
          freqHz,
          rmsDb: matches.length ? Number(matches[matches.length - 1][1]) : -Infinity,
        }
      }),
    )
    return detectCutoff(bands, nyquist)
  } finally {
    await Promise.all(names.map((n) => unlink(join(dir, n)).catch(() => {})))
  }
}

interface SpectrumDeps {
  probe: (input: string) => Promise<{ sampleRate: string }>
  spectrogram: (input: string) => Promise<string>
  cutoff: (input: string, sampleRateHz: number) => Promise<number>
}

interface SpectrumBuild {
  image: string
  cutoffHz: number | null
  sampleRateHz: number
  cutoffError?: unknown
}

// Builds the spectrogram image and measures the lossy cutoff in one go. The image
// is the whole point of the panel, so a failure in the (far more fragile) cutoff
// pass — a per-band filtergraph that writes and re-reads temp files and has
// repeatedly broken on Windows — must not discard a perfectly good image. We run
// both, but only a missing image rejects; a cutoff failure yields a null cutoff
// (so the UI hides the quality verdict rather than inventing one) and the real
// ffmpeg error is handed back for the caller to log instead of swallowing it.
export async function buildSpectrum(input: string, deps: SpectrumDeps): Promise<SpectrumBuild> {
  const sampleRateHz = Number((await deps.probe(input)).sampleRate) || 0
  const [imageR, cutoffR] = await Promise.allSettled([
    deps.spectrogram(input),
    deps.cutoff(input, sampleRateHz),
  ])
  if (imageR.status === 'rejected') throw imageR.reason
  return {
    image: imageR.value,
    cutoffHz: cutoffR.status === 'fulfilled' ? cutoffR.value : null,
    sampleRateHz,
    cutoffError: cutoffR.status === 'rejected' ? cutoffR.reason : undefined,
  }
}
