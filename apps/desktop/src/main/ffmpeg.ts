import { execFile } from 'node:child_process'
import { copyFile, readFile, rename, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { formatRatingTag, ratingTagToStars } from '../shared/rating'
import type {
  BpmResult,
  KeyResult,
  LoudnessResult,
  NormalizeConfig,
  OutputFormat,
  TrackMetadata,
  TrackProperties,
} from '../shared/types'
import { ffmpegPath, ffprobePath } from './binaries'
import { BAND_WIDTH_HZ, bandFrequencies, detectCutoff } from './cutoff'
import {
  loudnormArgs,
  loudnormFilter,
  parseLoudnorm,
  parseMaxVolume,
  peakGainDb,
  volumedetectArgs,
  volumeFilter,
} from './normalize'
import { readTagFormats } from './tagFormats'
import { preservesCuesInPlace } from './tags'
import { TEMPO_SAMPLE_RATE } from './tempo'
import { tmpName } from './tmp'
import { runInWorker } from './worker'

// Re-exported so the existing main-process imports (index.ts, tests) keep their
// path; the canonical definition lives in shared/ so the renderer can use it too.
export { formatMatchesInput } from '../shared/format'

const run = promisify(execFile)

interface ProbeTags {
  format?: { tags?: Record<string, unknown> }
  streams?: { codec_type?: string; tags?: Record<string, unknown> }[]
}

// Maps an ffprobe tag dump onto our metadata fields so a freshly loaded track
// arrives pre-filled. Tags live under format.tags for WAV/FLAC/AIFF (and
// stream.tags for some containers); keys vary in case across muxers, so we match
// case-insensitively and accept the common aliases each writer uses.
export function tagsFromProbe(data: ProbeTags): TrackMetadata {
  // Skip the attached-picture stream: FLAC stores the cover's "Cover (front)"
  // description as a comment tag on that video stream, which would otherwise be read
  // as the track's comment whenever the file carries embedded art.
  const sources: Record<string, unknown>[] = [
    data.format?.tags,
    ...(data.streams ?? []).filter((s) => s.codec_type !== 'video').map((s) => s.tags),
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
    grouping: pick('grouping', 'content_group', 'tit1', 'grp1'),
    comment: pick('comment'),
    // A "3/12" track tag would survive zero-padding as "312", so drop the total.
    trackNumber: pick('track', 'tracknumber').split('/')[0].trim(),
    discNumber: pick('disc', 'tpos', 'disc_number', 'discnumber').split('/')[0].trim(),
    bpm: pick('tbpm', 'bpm'),
    key: pick('tkey', 'initial_key', 'initialkey'),
    publisher: pick('publisher', 'tpub', 'label', 'organization'),
    catalogNumber: pick('catalognumber', 'catalog_number', 'catalogue', 'catalog'),
    remixArtist: pick('tpe4', 'remixer', 'remixed_by', 'remixedby', 'remix_artist'),
    discogsReleaseId: pick('discogs_release_id', 'discogs_releaseid', 'discogsreleaseid'),
    // ffprobe exposes FLAC's Vorbis RATING comment but not the ID3 POPM frame, so
    // a rating only round-trips for FLAC; MP3/AIFF start unrated in the editor.
    rating: ratingTagToStars(pick('rating', 'rating wmp')),
    composer: pick('composer', 'tcom'),
    isrc: pick('tsrc', 'isrc'),
    mixName: pick('tit3', 'subtitle', 'mixname', 'mix_name'),
    // TORY is what our own ID3v2.3 writes; TDOR is its v2.4 successor and
    // ORIGINALYEAR the Picard-convention Vorbis comment.
    originalYear: pick('tory', 'tdor', 'originalyear', 'original_year'),
    // Boolean-ish flag: only a literal '1' counts as set, so a TCMP=0 (or junk)
    // never shows the checkbox ticked for a non-compilation.
    compilation: pick('compilation', 'tcmp', 'cpil') === '1' ? '1' : '',
  }
}

// The container's total duration in seconds, for the track row's time readout.
// Returns null rather than throwing on a missing/unparseable value, so a probe
// failure leaves the row without a time instead of aborting the whole file add
// (which runs this alongside readTags/readCover).
export async function probeDuration(input: string): Promise<number | null> {
  try {
    const { stdout } = await run(ffprobePath, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      input,
    ])
    const seconds = Number(JSON.parse(stdout).format?.duration)
    return Number.isFinite(seconds) ? seconds : null
  } catch {
    return null
  }
}

export async function readTags(input: string): Promise<TrackMetadata> {
  const { stdout } = await run(ffprobePath, [
    '-v',
    'error',
    '-show_entries',
    'format_tags:stream_tags:stream=codec_type',
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

// Full-resolution extract to a temp file, for the WRITE paths (embedding at convert
// time, exporting, dragging out). The renderer's session-long copy is a thumbnail,
// so anything that writes art pulls it fresh from the source. The caller owns the
// returned file's cleanup.
export async function extractCoverFile(input: string): Promise<string | null> {
  const out = join(tmpdir(), tmpName('cover-full', 'jpg'))
  try {
    await run(ffmpegPath, coverArgs(input, out))
    return out
  } catch {
    await unlink(out).catch(() => {})
    return null
  }
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

interface PropertiesProbe {
  streams?: {
    codec_name?: string
    bits_per_raw_sample?: string
    sample_rate?: string
    channels?: number
    bit_rate?: string
  }[]
  format?: { format_name?: string; bit_rate?: string; size?: string }
}

interface FileStat {
  sizeBytes: number
  createdMs: number | null
  modifiedMs: number | null
}

// Maps an ffprobe stream+format dump and an fs.stat onto the read-only facts shown
// in the Properties panel. Pure so the parsing is unit-tested without spawning
// ffprobe; probeProperties wires the two real sources in.
export function propertiesFromProbe(
  data: PropertiesProbe,
  file: FileStat,
  tagFormats: string[] = [],
): TrackProperties {
  const stream = data.streams?.[0] ?? {}
  const format = data.format ?? {}
  const bitrate = Number(format.bit_rate ?? stream.bit_rate)
  return {
    codec: String(stream.codec_name ?? ''),
    container: String(format.format_name ?? '')
      .split(',')[0]
      .trim(),
    sampleRateHz: Number(stream.sample_rate) || 0,
    bitDepth: Number(stream.bits_per_raw_sample) || null,
    channels: Number(stream.channels) || 0,
    bitrateKbps: Number.isFinite(bitrate) && bitrate > 0 ? Math.round(bitrate / 1000) : null,
    sizeBytes: file.sizeBytes,
    createdMs: file.createdMs,
    modifiedMs: file.modifiedMs,
    tagFormats,
  }
}

export async function probeProperties(input: string): Promise<TrackProperties> {
  const { stdout } = await run(ffprobePath, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_name,bits_per_raw_sample,sample_rate,channels,bit_rate:format=format_name,bit_rate,size',
    '-of',
    'json',
    input,
  ])
  const [s, tagFormats] = await Promise.all([stat(input), readTagFormats(input).catch(() => [])])
  return propertiesFromProbe(
    JSON.parse(stdout),
    {
      sizeBytes: s.size,
      createdMs: s.birthtimeMs || null,
      modifiedMs: s.mtimeMs || null,
    },
    tagFormats,
  )
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

function metadataArgs(meta: TrackMetadata, vorbis: boolean): string[] {
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
    // The FLAC muxer has no ID3 mapping and writes keys verbatim, so a Vorbis
    // target gets the comment names Traktor and Mixed In Key read instead.
    ['disc', meta.discNumber],
    [vorbis ? 'BPM' : 'TBPM', meta.bpm],
    [vorbis ? 'INITIALKEY' : 'TKEY', meta.key],
    [vorbis ? 'REMIXER' : 'TPE4', meta.remixArtist],
    ['publisher', meta.publisher],
    ['composer', meta.composer ?? ''],
    [vorbis ? 'ISRC' : 'TSRC', meta.isrc ?? ''],
    [vorbis ? 'SUBTITLE' : 'TIT3', meta.mixName ?? ''],
    // TORY, not TDOR: the ID3 targets are pinned to v2.3, where TDOR doesn't exist.
    [vorbis ? 'ORIGINALYEAR' : 'TORY', meta.originalYear ?? ''],
    // 'compilation' is ffmpeg's mapped name for the TCMP frame iTunes reads.
    [vorbis ? 'COMPILATION' : 'compilation', meta.compilation ?? ''],
    ['CATALOGNUMBER', meta.catalogNumber],
    ['DISCOGS_RELEASE_ID', meta.discogsReleaseId ?? ''],
  ]
  return pairs.filter(([, v]) => v?.trim()).flatMap(([k, v]) => ['-metadata', `${k}=${v}`])
}

const AIFF_INPUT = /\.aiff?$/i
const MP3_INPUT = /\.mp3$/i
const WAV_INPUT = /\.wav$/i
const FLAC_INPUT = /\.flac$/i
const MP3_BITRATE = '320k'

export function convertArgs(
  input: string,
  output: string,
  codec: string,
  meta: TrackMetadata,
  coverPath?: string,
  bitrate?: string,
  audioFilter?: string,
): string[] {
  // WAV is a single-stream RIFF container, so ffmpeg refuses to mux an attached
  // picture into it ("WAVE files have exactly one stream"). The cover still
  // reaches Apple Music via AppleScript, so a WAV target simply skips the embed.
  const embedCover = coverPath && !WAV_INPUT.test(output) ? coverPath : undefined
  const args = ['-y', '-i', input]
  if (embedCover) args.push('-i', embedCover)

  args.push('-map', '0:a')
  if (embedCover) args.push('-map', '1:v', '-c:v', 'copy', '-disposition:v:0', 'attached_pic')

  // Normalization filter (loudnorm / volume), applied to the audio before encoding.
  if (audioFilter) args.push('-af', audioFilter)
  args.push('-c:a', codec)
  if (bitrate) args.push('-b:a', bitrate)
  args.push('-write_id3v2', '1', '-id3v2_version', '3')
  args.push(...metadataArgs(meta, FLAC_INPUT.test(output)))
  // FLAC carries the rating as a Vorbis RATING comment (POPM is ID3-only, written
  // by the TagLib pass for the other formats). Steps of 51, matching Traktor.
  const rating = Number(meta.rating)
  if (output.toLowerCase().endsWith('.flac') && meta.rating?.trim() && rating > 0) {
    args.push('-metadata', `RATING=${formatRatingTag(rating)}`)
  }
  args.push(output)
  return args
}

export interface ConversionPlan {
  codec: string
  bitrate?: string
  ext: '.aiff' | '.mp3' | '.wav' | '.flac'
}

// Decides how to render a source into the chosen output format. A source
// already in the target format is bit-identical, so it stream-copies (instant);
// otherwise it encodes — lossless to bit-depth-preserving PCM for AIFF/WAV
// (big-endian for AIFF, little-endian for WAV), or to a fixed 320 kbps for MP3.
// The bit depth only matters for the lossless targets, so MP3 skips the probe.
// `normalize` forces a re-encode: applying a loudness/peak filter changes the
// samples, so a stream copy (which would emit the untouched source) is never
// valid — every matching-format shortcut is gated on it being off.
export async function planConversion(
  input: string,
  format: OutputFormat,
  probe: (input: string) => Promise<ProbeResult>,
  normalize = false,
): Promise<ConversionPlan> {
  if (format === 'mp3') {
    if (MP3_INPUT.test(input) && !normalize) return { codec: 'copy', ext: '.mp3' }
    return { codec: 'libmp3lame', bitrate: MP3_BITRATE, ext: '.mp3' }
  }
  if (format === 'wav') {
    if (WAV_INPUT.test(input) && !normalize) return { codec: 'copy', ext: '.wav' }
    return { codec: pcmCodec(await probe(input), 'le'), ext: '.wav' }
  }
  if (format === 'flac') {
    // FLAC is losslessly compressed and the encoder reads the source bit depth
    // itself, so there is no PCM width or endianness to choose — no probe needed.
    if (FLAC_INPUT.test(input) && !normalize) return { codec: 'copy', ext: '.flac' }
    return { codec: 'flac', ext: '.flac' }
  }
  if (AIFF_INPUT.test(input) && !normalize) return { codec: 'copy', ext: '.aiff' }
  return { codec: pcmCodec(await probe(input), 'be'), ext: '.aiff' }
}

// Resolves the audio filter for the chosen normalization, running the required
// measurement pass first: a two-pass linear loudnorm for the loudness target, or
// volumedetect + a constant gain for peak. Returns null (no filter) for mode
// 'none' and whenever the measurement can't be parsed, so a measurement failure
// degrades to a plain conversion instead of aborting it.
export async function normalizeFilter(
  input: string,
  cfg: NormalizeConfig,
  sampleRate?: number,
): Promise<string | null> {
  if (cfg.mode === 'none') return null
  if (cfg.mode === 'peak') {
    // Peak mode is a constant-gain `volume` filter, which doesn't resample, so it
    // needs no rate restoration.
    const { stderr } = await run(ffmpegPath, volumedetectArgs(input), {
      maxBuffer: 1024 * 1024 * 16,
    })
    const max = parseMaxVolume(stderr)
    return max === null ? null : volumeFilter(peakGainDb(cfg.peakDb, max))
  }
  const { stderr } = await run(ffmpegPath, loudnormArgs(input, cfg), {
    maxBuffer: 1024 * 1024 * 16,
  })
  const measured = parseLoudnorm(stderr)
  return measured ? loudnormFilter(cfg, measured, sampleRate) : null
}

export async function convertAudio(
  input: string,
  output: string,
  format: OutputFormat,
  meta: TrackMetadata,
  coverPath?: string,
  normalize?: NormalizeConfig,
  removeCover?: boolean,
): Promise<void> {
  // We always write to a temp file and rename it over the target, so
  // re-processing a file that already lives in the output folder (input path ===
  // output path) overwrites it atomically instead of failing with ffmpeg's
  // "Output same as Input" error.
  // Re-encoding through ffmpeg drops Traktor's GEOB cues regardless, so the gain
  // filter only ever rides the encode path — planConversion is told to skip the
  // stream-copy shortcuts when normalizing.
  const normalizing = normalize !== undefined && normalize.mode !== 'none'
  // loudnorm emits 192 kHz; pass the source rate so the filter can resample back.
  // Only probed for the loudnorm path — peak mode's volume filter keeps the rate.
  const sampleRate =
    normalize?.mode === 'loudness'
      ? Number((await probeAudio(input)).sampleRate) || undefined
      : undefined
  const audioFilter = normalizing
    ? ((await normalizeFilter(input, normalize, sampleRate)) ?? undefined)
    : undefined
  const { codec, bitrate, ext } = await planConversion(input, format, probeAudio, normalizing)
  const tmp = output.replace(new RegExp(`\\${ext}$`, 'i'), `.tmp${ext}`)

  try {
    if (codec === 'copy' && preservesCuesInPlace(ext)) {
      // Source already in the target format: copy the bytes verbatim and edit the
      // tag in place (see tags.ts) instead of re-muxing through ffmpeg, which
      // would drop Traktor's cue/beatgrid GEOB frame even on a stream copy.
      // TagLib's save is synchronous and rewrites the whole file when the tag
      // grows, so every tag pass below runs in the worker thread.
      await copyFile(input, tmp)
      await runInWorker({ type: 'writeTags', file: tmp, meta, coverPath, removeCover })
    } else {
      await run(ffmpegPath, convertArgs(input, tmp, codec, meta, coverPath, bitrate, audioFilter), {
        maxBuffer: 1024 * 1024 * 32,
      })
      if (ext === '.wav') {
        // RIFF rejects an attached-picture stream, so convertArgs can't embed the
        // cover and drops tags with no RIFF-INFO field (grouping). TagLib writes a
        // full ID3v2 tag into a WAV "id3 " chunk instead, which carries the artwork
        // and grouping — and which ffmpeg reads back as a video stream on re-import.
        await runInWorker({ type: 'writeTags', file: tmp, meta, coverPath })
      } else if (meta.rating?.trim() && (ext === '.mp3' || ext === '.aiff')) {
        // ffmpeg can't emit a POPM frame, so a re-encoded MP3/AIFF needs a TagLib
        // pass to write the Traktor rating. Only done when there's a rating, to
        // avoid a second tag pass on every conversion.
        await runInWorker({ type: 'writeTags', file: tmp, meta, coverPath })
      }
      // Normalizing forces this re-encode, which drops Traktor's GEOB cue/beatgrid
      // frame. A constant gain never moves the cues in time, so carry the frame over
      // from the source — but only for the ID3 containers it round-trips through.
      if (normalizing && preservesCuesInPlace(ext))
        await runInWorker({ type: 'copyCueFrames', source: input, dest: tmp })
    }
    await rename(tmp, output)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
}

// The renderer's <audio> element decodes WAV/FLAC/MP3 but not AIFF, so an AIFF
// source plays nothing. We render it to a WAV the player can decode: keep only
// the audio (a stray attached-picture stream would make ffmpeg reject the
// single-stream RIFF container) and re-encode the PCM little-endian, since AIFF
// stores it big-endian and a stream copy would corrupt every sample.
export function previewWavArgs(input: string, output: string, codec: string): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    input,
    '-map',
    '0:a',
    '-c:a',
    codec,
    output,
  ]
}

// Transcodes an AIFF into a WAV the player can decode, preserving the source bit
// depth exactly (the player only needs to play it, but losing precision for a
// preview would still misrepresent the rip).
export async function transcodeAiffToWav(input: string, output: string): Promise<void> {
  const codec = pcmCodec(await probeAudio(input), 'le')
  await run(ffmpegPath, previewWavArgs(input, output, codec), { maxBuffer: 1024 * 1024 * 32 })
}

// Re-muxes a FLAC keeping only its audio, dropping a malformed embedded picture
// (see flac.ts) that Chromium's <audio> demuxer refuses to open. `-c:a copy` is a
// lossless stream copy — instant and bit-identical — so the served preview is the
// same audio, just without the unreadable art. Global tags ride along by default.
export function stripPictureArgs(input: string, output: string): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    input,
    '-map',
    '0:a',
    '-c:a',
    'copy',
    output,
  ]
}

export async function stripFlacPicture(input: string, output: string): Promise<void> {
  await run(ffmpegPath, stripPictureArgs(input, output), { maxBuffer: 1024 * 1024 * 32 })
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
      // cividis: a deep-navy → blue → yellow ramp. Its dark blue base sits naturally on
      // the app's dark UI (and reads fine framed in the light theme), while the yellow
      // peaks keep loud content legible. Bump the cache namespace when this changes so
      // images cached under the old palette regenerate instead of showing stale colors.
      'showspectrumpic=s=1000x280:legend=0:color=cividis:gain=2',
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
// bandpass→astats branch per band, prints each band's running stats to stdout
// (file=-) tagged with a surcoband=<freq> metadata key, then mixes the branches
// so ffmpeg has a single output to render.
//
// It writes no temp files on purpose. An ametadata file= path like
// C:\Users\...\x.txt is unparseable by ffmpeg's filtergraph (':' separates
// options and '\' escapes, and no escaping is reliable), which is exactly what
// broke on Windows. Printing to stdout sidesteps filesystem paths entirely; the
// surcoband tag lets analyzeCutoff split the merged stream back per band.
export function cutoffFilter(freqs: number[]): string {
  const branches = freqs
    .map(
      (f, i) =>
        `[b${i}]ametadata=mode=add:key=surcoband:value=${f},` +
        `bandpass=f=${f}:width_type=h:w=${BAND_WIDTH_HZ},astats=metadata=1:reset=0,` +
        `ametadata=mode=print:file=-[o${i}]`,
    )
    .join(';')
  return (
    `[0:a]asetnsamples=n=1048576:p=0,asplit=${freqs.length}${freqs.map((_, i) => `[b${i}]`).join('')};` +
    `${branches};${freqs.map((_, i) => `[o${i}]`).join('')}amix=inputs=${freqs.length}`
  )
}

// Pairs each band's centre frequency with its cumulative RMS from the tagged
// stdout the filter prints. Within a band's block the surcoband tag prints just
// before its Overall RMS, so we attribute each RMS to the band tagged most
// recently; astats runs with reset=0, so the last block per band carries the
// whole-file level — last write wins.
export function parseBands(stdout: string): Map<number, number> {
  const rms = new Map<number, number>()
  let band: number | null = null
  for (const line of stdout.split('\n')) {
    const tag = line.match(/surcoband=(\d+)/)
    if (tag) {
      band = Number(tag[1])
      continue
    }
    const level = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+)/)
    if (level && band !== null) rms.set(band, Number(level[1]))
  }
  return rms
}

// Measures the energy in each high-frequency band in a single decode (asplit
// into one bandpass→astats branch per band) and hands the per-band RMS to
// detectCutoff, which spots the codec's brick wall.
export async function analyzeCutoff(input: string, sampleRateHz: number): Promise<number> {
  const nyquist = sampleRateHz / 2
  const freqs = bandFrequencies(nyquist)
  if (freqs.length < 2) return nyquist

  const { stdout } = await run(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      input,
      '-filter_complex',
      cutoffFilter(freqs),
      '-f',
      'null',
      '-',
    ],
    { maxBuffer: 1024 * 1024 * 16 },
  )
  const rms = parseBands(stdout)
  const bands = freqs.map((freqHz) => ({ freqHz, rmsDb: rms.get(freqHz) ?? -Infinity }))
  return detectCutoff(bands, nyquist)
}

// Reads the three figures we surface from ebur128's end-of-run Summary block.
// ebur128 also prints a per-frame log line (each carrying its own "I:" and
// "LRA:") for the whole track, and at t≈0 those read the -70 LUFS gate floor and
// 0.0 LU — so we must parse the final "Summary:" block, not the first match, or a
// perfectly loud track reports as near-silent. The "I:" / "Peak:" anchors are
// unique to the integrated-loudness and true-peak rows; "LRA:" matches the
// range value but not "LRA low/high:" (no colon right after "LRA"). A -inf
// reading (silence) becomes -Infinity so the UI shows "−∞" instead of NaN.
export function parseLoudness(
  stderr: string,
): Pick<LoudnessResult, 'integratedLufs' | 'truePeakDb' | 'lra'> | null {
  const start = stderr.lastIndexOf('Summary:')
  if (start === -1) return null
  const summary = stderr.slice(start)
  const num = (m: RegExpMatchArray | null): number | null =>
    m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : null
  const integratedLufs = num(summary.match(/\bI:\s*(-inf|-?[\d.]+)\s*LUFS/))
  const truePeakDb = num(summary.match(/\bPeak:\s*(-inf|-?[\d.]+)\s*dBFS/))
  const lra = num(summary.match(/\bLRA:\s*(-inf|-?[\d.]+)\s*LU\b/))
  if (integratedLufs === null || truePeakDb === null || lra === null) return null
  return { integratedLufs, truePeakDb, lra }
}

export interface AstatsResult {
  balanceDb: number | null
  dcOffset: number | null
  crestDb: number | null
  noiseFloorDb: number | null
}

// Pulls the channel checks out of astats' summary. Every line carries a
// "[Parsed_astats_0 @ …]" prefix; sections are introduced by "Channel: N" and
// "Overall". Per-channel RMS gives the L/R balance; the Overall block gives DC
// offset, crest (peak − RMS) and the noise floor. ffmpeg can print "nan"/"-inf"
// (e.g. a silent channel), so every value is finite-checked and a non-finite one
// is dropped — the caller then hides that pill instead of showing "−∞"/"NaN".
// Returns null only when there is no astats block at all.
export function parseAstats(stderr: string): AstatsResult | null {
  const finite = (s: string): number | null => {
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  const channelRms: number[] = []
  const overall: { peak?: number; rms?: number; dc?: number; noise?: number } = {}
  let section: 'channel' | 'overall' | null = null
  let seen = false
  for (const raw of stderr.split('\n')) {
    const line = raw.replace(/^\[Parsed_astats[^\]]*\]\s*/, '').trim()
    if (/^Channel:\s*\d+/.test(line)) {
      section = 'channel'
      seen = true
    } else if (line === 'Overall') {
      section = 'overall'
      seen = true
    } else if (section === 'channel') {
      const m = line.match(/^RMS level dB:\s*(\S+)/)
      if (m) {
        const v = finite(m[1])
        if (v !== null) channelRms.push(v)
      }
    } else if (section === 'overall') {
      const peak = line.match(/^Peak level dB:\s*(\S+)/)
      if (peak) overall.peak = finite(peak[1]) ?? undefined
      const rms = line.match(/^RMS level dB:\s*(\S+)/)
      if (rms) overall.rms = finite(rms[1]) ?? undefined
      const dc = line.match(/^DC offset:\s*(\S+)/)
      if (dc) {
        const v = finite(dc[1])
        if (v !== null) overall.dc = Math.abs(v)
      }
      const noise = line.match(/^Noise floor dB:\s*(\S+)/)
      if (noise) overall.noise = finite(noise[1]) ?? undefined
    }
  }
  if (!seen) return null
  return {
    // Both channels must be finite; a dropped (silent) channel leaves length < 2.
    balanceDb: channelRms.length >= 2 ? Math.abs(channelRms[0] - channelRms[1]) : null,
    dcOffset: overall.dc ?? null,
    crestDb:
      overall.peak !== undefined && overall.rms !== undefined ? overall.peak - overall.rms : null,
    noiseFloorDb: overall.noise ?? null,
  }
}

// Measures EBU R128 loudness and the per-channel checks (balance, DC offset) in a
// single decode by chaining astats and ebur128 — both print their summary to
// stderr at info level, so — unlike the other ffmpeg helpers — we must not pass
// `-loglevel error`, or there would be nothing to parse; we mute only the periodic
// progress lines with `-nostats`.
export async function measureLoudness(input: string): Promise<LoudnessResult | null> {
  const { stderr } = await run(
    ffmpegPath,
    [
      '-hide_banner',
      '-nostats',
      '-i',
      input,
      '-af',
      'astats=metadata=1:reset=0,ebur128=peak=true',
      '-f',
      'null',
      '-',
    ],
    { maxBuffer: 1024 * 1024 * 16 },
  )
  const loud = parseLoudness(stderr)
  if (!loud) return null
  const stats = parseAstats(stderr)
  return {
    ...loud,
    channelBalanceDb: stats?.balanceDb ?? null,
    dcOffset: stats?.dcOffset ?? null,
    crestDb: stats?.crestDb ?? null,
    noiseFloorDb: stats?.noiseFloorDb ?? null,
  }
}

// Decodes the opening four minutes to low-rate mono PCM for the tempo and key
// detectors. Four minutes pins a steady DJ tempo (and the prevailing key)
// while bounding the decoded buffer (~10 MB) regardless of file length; mono
// because both are properties of the mix, not of either channel. ffmpeg emits
// raw f32le so there is nothing to parse — but the bytes land in Node's
// shared Buffer pool, whose offset need not be 4-byte aligned, so they are
// copied out before being viewed as floats.
async function decodeAnalysisPcm(input: string): Promise<Float32Array> {
  const { stdout } = await run(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      input,
      '-t',
      '240',
      '-ac',
      '1',
      '-ar',
      String(TEMPO_SAMPLE_RATE),
      '-f',
      'f32le',
      '-',
    ],
    { encoding: 'buffer', maxBuffer: 1024 * 1024 * 16 },
  )
  const bytes = stdout.length - (stdout.length % 4)
  const pcm = new Uint8Array(bytes)
  pcm.set(stdout.subarray(0, bytes))
  return new Float32Array(pcm.buffer)
}

// The detectors crunch hundreds of FFTs in tight JS loops — run on the main process
// they freeze IPC, the menu and the surco:// audio stream for the whole analysis, so
// both ship their PCM to the worker thread. The buffer is transferred, not copied:
// decodeAnalysisPcm mints a fresh one per call, so nothing else holds it.
export async function measureBpm(input: string): Promise<BpmResult | null> {
  const pcm = await decodeAnalysisPcm(input)
  return runInWorker<BpmResult | null>({ type: 'bpm', pcm, sampleRate: TEMPO_SAMPLE_RATE }, [
    pcm.buffer as ArrayBuffer,
  ])
}

export async function measureKey(input: string): Promise<KeyResult | null> {
  const pcm = await decodeAnalysisPcm(input)
  return runInWorker<KeyResult | null>({ type: 'key', pcm, sampleRate: TEMPO_SAMPLE_RATE }, [
    pcm.buffer as ArrayBuffer,
  ])
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
