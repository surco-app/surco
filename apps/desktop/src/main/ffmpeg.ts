import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants as fsConstants, copyFile, readFile, rename, stat, unlink } from 'node:fs/promises'
import { constants as osConstants, setPriority, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { snapAnchor } from '../shared/beatgrid'
import { formatRatingTag } from '../shared/rating'
import type {
  Beatgrid,
  BeatgridResult,
  BpmResult,
  ConversionQuality,
  CoverRead,
  DeclickMode,
  KeyResult,
  LoudnessResult,
  MetaRead,
  NormalizeConfig,
  OutputFormat,
  TrackMetadata,
  Mp3Quality,
  TrackProperties,
  TrimRange,
  WaveformResult,
} from '../shared/types'
import { cachedAnalysis } from './analysisCache'
import { seratoBeatgridVorbis } from './seratoBeatgrid'
import { ffmpegPath, ffprobePath } from './binaries'
import { countClicks } from './clickDetect'
import { declickFilter } from '../shared/declick'
import { trimFilter } from '../shared/trim'
import {
  declickRemovedArgs,
  parseDeclickedSamples,
  parseDeclickedShare,
  previewWindow,
} from './declick'
import {
  BAND_WIDTH_HZ,
  bandFrequencies,
  type CutoffResult,
  detectCutoff,
  detectUpsample,
  FINE_BAND_WIDTH_HZ,
  fineBandFrequencies,
  UPSAMPLE_MIN_NYQUIST_HZ,
  UPSAMPLE_PROBE_ABOVE_HZ,
  UPSAMPLE_PROBE_BELOW_HZ,
} from './cutoff'
import {
  detectFftKnee,
  detectFlatShelf,
  BAND_START_HZ as SHELF_BAND_START_HZ,
  BAND_WIDTH_HZ as SHELF_BAND_WIDTH_HZ,
} from './hfShelf'
import {
  limitedLoudnormFilter,
  astatsArgs,
  loudnormArgs,
  loudnormFilter,
  parseAstatsChannels,
  parseLoudnorm,
  parseMaxVolume,
  peakChannelFilter,
  peakGainDb,
  reachesTargetLinearly,
  volumedetectArgs,
  volumeFilter,
} from './normalize'
import { TAG_FIELDS } from './tagFields'
import { readTagFormats } from './tagFormats'
import { preservesCuesInPlace } from './tags'
import { TEMPO_SAMPLE_RATE } from './tempo'
import { tmpName } from './tmp'
import { type ChannelWave, computePeaks, createChannelScan, WAVEFORM_SAMPLE_RATE } from './waveform'
import { isMalformedInputError, repairWav } from './wavRepair'
import { runInWorker } from './worker'

// Re-exported so the existing main-process imports (index.ts, tests) keep their
// path; the canonical definition lives in shared/ so the renderer can use it too.
export { formatMatchesInput } from '../shared/format'

const execFileAsync = promisify(execFile)

// Analysis decodes are CPU background work: a "Analizar calidad" sweep can put a dozen
// ffmpeg processes on the cores at once (each spectrum spawns three), and at normal OS
// priority they time-slice against the renderer and the surco:// audio stream, so the
// UI stutters and playback crackles while the spectrum builds. Spawning each child
// below-normal lets the scheduler preempt it for the UI the moment they compete; with
// no contention (machine otherwise idle) it still runs full speed, so sweep throughput
// is unchanged. Best-effort: setPriority can lose a race with a child that exits
// immediately, and Windows may deny it — a normal-priority decode is a fine fallback.
// Cancel has no way to reach an already-running conversion otherwise: the caller
// hands in this hook to learn the child the moment it spawns and register a way
// to kill it (see activeConversions.ts). Not an execFile option — pulled out of
// opts before the rest reaches execFileAsync, which would reject an unknown key.
interface RunOpts {
  onChild?: (child: { kill: (signal: string) => void }) => void
  [key: string]: unknown
}

const niceDecode = (file: string, args: string[], opts?: RunOpts) => {
  const { onChild, ...execOpts } = opts ?? {}
  const pending = execFileAsync(file, args, execOpts as never)
  const pid = pending.child?.pid
  if (pid !== undefined) {
    try {
      setPriority(pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
    } catch {
      // Lowering priority is an optimization, never a requirement: if the child has
      // already exited or the OS denies it, the decode just runs at normal priority.
    }
  }
  // ChildProcess.kill's real signature (NodeJS.Signals | number) is narrower than
  // callers need to know about — activeConversions only ever passes 'SIGTERM',
  // a valid Signals string at runtime, so the plain-string callback type stands.
  if (pending.child) onChild?.(pending.child as unknown as { kill: (signal: string) => void })
  return pending
}

// Spawns ffmpeg/ffprobe, with one recovery: when a call fails because the demuxer
// rejected a malformed input (e.g. a WAV carrying a zero-size LIST chunk), repair a
// temp copy of the offending file and retry once, so a single bad header chunk no
// longer sinks tags, the spectrogram and every other analysis for that track. The
// repair is gated on the error message, so healthy files never reach it (a normal
// non-zero exit just rethrows); repairWav returns null for any arg that isn't a
// fixable WAV, so flags and output paths are skipped and only the source is copied.
// The temp copy is deleted after the retry resolves.
const run = (async (file: string, args: string[], opts?: RunOpts) => {
  try {
    return await niceDecode(file, args, opts)
  } catch (err) {
    if (!isMalformedInputError(err)) throw err
    for (let i = 0; i < args.length; i++) {
      const repaired = await repairWav(args[i])
      if (!repaired) continue
      const retry = [...args]
      retry[i] = repaired
      try {
        return await niceDecode(file, retry, opts)
      } finally {
        await unlink(repaired).catch(() => {})
      }
    }
    throw err
  }
}) as typeof execFileAsync & ((file: string, args: string[], opts?: RunOpts) => ReturnType<typeof execFileAsync>)

// A stalled network mount (an SMB share that stops responding mid-read) makes an
// ffmpeg/ffprobe decode block forever. Without a bound, the analysisLimiter slot — and
// the renderer's quality-sweep slot awaiting it — never frees, so the whole "Analizar
// calidad" sweep freezes mid-run while CPU falls to idle. execFile's own timeout kills
// the child (SIGTERM) and rejects, so the hung file is dropped and the sweep moves on.
// Generous on purpose: a working decode of a long track over a slow-but-alive drive
// still finishes well under this, while a true stall is effectively infinite. Only the
// analysis reads carry it — conversions can legitimately run for minutes, so they keep
// their unbounded behavior.
const ANALYSIS_TIMEOUT_MS = 120_000

interface ProbeTags {
  format?: { tags?: Record<string, unknown> }
  streams?: { codec_type?: string; tags?: Record<string, unknown> }[]
}

// Maps an ffprobe tag dump onto our metadata fields so a freshly loaded track
// arrives pre-filled. Tags live under format.tags for WAV/FLAC/AIFF (and
// stream.tags for some containers); keys vary in case across muxers, so we match
// case-insensitively and accept the common aliases each writer uses. The aliases
// (and the per-field normalization) live in the TAG_FIELDS registry.
export function tagsFromProbe(data: ProbeTags): TrackMetadata {
  // Skip the attached-picture stream: FLAC stores the cover's "Cover (front)"
  // description as a comment tag on that video stream, which would otherwise be read
  // as the track's comment whenever the file carries embedded art.
  const sources: Record<string, unknown>[] = [
    data.format?.tags,
    ...(data.streams ?? []).filter((s) => s.codec_type !== 'video').map((s) => s.tags),
  ].filter((t): t is Record<string, unknown> => Boolean(t))
  // First non-empty wins, in `names`' own priority order (see TAG_FIELDS) — not the
  // order keys happen to appear in the source object. A file passed between taggers
  // can carry a blanked-out higher-priority alias (e.g. an empty DATE) alongside a
  // real value in a lower-priority fallback (YEAR); stopping at the first key that
  // merely exists, empty or not, would shadow that real data with a blank field.
  const pick = (...names: string[]): string => {
    for (const name of names) {
      for (const tags of sources) {
        for (const [key, value] of Object.entries(tags)) {
          if (key.toLowerCase() !== name) continue
          const trimmed = String(value ?? '').trim()
          if (trimmed) return trimmed
        }
      }
    }
    return ''
  }
  const meta = {} as Record<keyof TrackMetadata, string>
  for (const field of TAG_FIELDS) {
    const raw = pick(...field.aliases)
    meta[field.key] = field.parse ? field.parse(raw) : raw
  }
  return meta
}

// The container's total duration in seconds, for the track row's time readout.
// Returns null rather than throwing on a missing/unparseable value, so a probe
// failure leaves the row without a time instead of aborting the whole file add
// (which runs this alongside readTags/readCover).
export async function probeDuration(input: string): Promise<number | null> {
  try {
    const { stdout } = await run(
      ffprobePath,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', input],
      { timeout: ANALYSIS_TIMEOUT_MS },
    )
    const seconds = Number(JSON.parse(stdout).format?.duration)
    return Number.isFinite(seconds) ? seconds : null
  } catch {
    return null
  }
}

export async function readTags(input: string): Promise<TrackMetadata> {
  const { stdout } = await run(
    ffprobePath,
    [
      '-v',
      'error',
      '-show_entries',
      'format_tags:stream_tags:stream=codec_type',
      '-of',
      'json',
      input,
    ],
    { timeout: ANALYSIS_TIMEOUT_MS },
  )
  return tagsFromProbe(JSON.parse(stdout))
}

// Pulls the first embedded picture out as a still image (no audio), letting the
// .jpg target drive the encoder so PNG art is transcoded too. ffmpeg exits
// non-zero when the file carries no attached picture. maxPx caps the longer side
// (keeping aspect ratio, never upscaling) for the renderer's display thumbnail.
export function coverArgs(input: string, output: string, maxPx?: number): string[] {
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
    ...(maxPx
      ? ['-vf', `scale='min(${maxPx},iw)':'min(${maxPx},ih)':force_original_aspect_ratio=decrease`]
      : []),
    output,
  ]
}

// Display-thumbnail cap. 512 keeps the editor's artwork well sharp on retina while
// staying ~30-60KB per track instead of the megabyte-scale original.
const COVER_THUMB_PX = 512

// Original size of the attached picture, probed without decoding it.
async function probeCoverDims(input: string): Promise<{ width: number; height: number }> {
  try {
    const { stdout } = await run(ffprobePath, [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'json',
      input,
    ])
    const s = JSON.parse(stdout).streams?.[0]
    const width = Number(s?.width)
    const height = Number(s?.height)
    return Number.isFinite(width) && Number.isFinite(height)
      ? { width, height }
      : { width: 0, height: 0 }
  } catch {
    return { width: 0, height: 0 }
  }
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

// The full-resolution art as a data URL, for the cover lightbox: the renderer's
// session-long copy is a 512px thumbnail, so viewing the art big pulls the original
// from the source file. A data URL (not the temp path) because the sandboxed
// renderer can't load arbitrary file:// images.
export async function extractCoverDataUrl(input: string): Promise<string | null> {
  const path = await extractCoverFile(input)
  if (!path) return null
  try {
    const buf = await readFile(path)
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  } finally {
    await unlink(path).catch(() => {})
  }
}

export async function extractCover(
  input: string,
  // readMeta already probed the dims from its combined ffprobe, so it passes them in to
  // skip the extra probeCoverDims spawn; the standalone audio:cover handler omits them.
  knownDims?: { width: number; height: number },
): Promise<CoverRead | null> {
  const out = join(tmpdir(), tmpName('cover', 'jpg'))
  try {
    await run(ffmpegPath, coverArgs(input, out, COVER_THUMB_PX))
    const buf = await readFile(out)
    const dims = knownDims ?? (await probeCoverDims(input))
    return { thumbUrl: `data:image/jpeg;base64,${buf.toString('base64')}`, ...dims }
  } catch {
    return null
  } finally {
    await unlink(out).catch(() => {})
  }
}

// Reads tags, duration and the cover thumbnail in one go for the import path. A single
// ffprobe pulls tags + duration + the art's pixel size, then one ffmpeg extracts the
// thumbnail — two processes instead of the four the separate readTags/probeDuration/
// extractCover calls spawned (each re-probing the same file).
export async function readMeta(input: string): Promise<MetaRead> {
  try {
    const { stdout } = await run(
      ffprobePath,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:format_tags:stream_tags:stream=codec_type,width,height',
        '-of',
        'json',
        input,
      ],
      { timeout: ANALYSIS_TIMEOUT_MS },
    )
    const data = JSON.parse(stdout)
    const seconds = Number(data.format?.duration)
    const video = (data.streams ?? []).find(
      (s: { codec_type?: string }) => s.codec_type === 'video',
    )
    const width = Number(video?.width)
    const height = Number(video?.height)
    const dims =
      Number.isFinite(width) && Number.isFinite(height)
        ? { width, height }
        : { width: 0, height: 0 }
    return {
      tags: tagsFromProbe(data),
      duration: Number.isFinite(seconds) ? seconds : null,
      cover: await extractCover(input, dims),
    }
  } catch {
    // A probe failure leaves an editable row with no tags/duration/cover — the same
    // degraded state the three granular reads reached when each failed on its own.
    return { tags: {} as TrackMetadata, duration: null, cover: null }
  }
}

interface ProbeResult {
  // The stream's codec — what tells a genuine float PCM source (pcm_f32le) apart from
  // a lossy decoder that merely emits float (mp3float/aac), see sourceDepth.
  codecName: string
  sampleFmt: string
  bitsPerRawSample: number
  sampleRate: string
  channels: number
}

export async function probeAudio(input: string): Promise<ProbeResult> {
  const { stdout } = await run(
    ffprobePath,
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=codec_name,sample_fmt,bits_per_raw_sample,sample_rate,channels',
      '-of',
      'json',
      input,
    ],
    { timeout: ANALYSIS_TIMEOUT_MS },
  )
  const stream = JSON.parse(stdout).streams?.[0] ?? {}
  return {
    codecName: String(stream.codec_name ?? ''),
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
  const { stdout } = await run(
    ffprobePath,
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=codec_name,bits_per_raw_sample,sample_rate,channels,bit_rate:format=format_name,bit_rate,size',
      '-of',
      'json',
      input,
    ],
    { timeout: ANALYSIS_TIMEOUT_MS },
  )
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

// The source's real sample precision, as the planner reasons about it.
interface SampleDepth {
  float: boolean
  bits: number
}

// float=true only for genuine float PCM sources (a field recorder's f32 WAV, a DAW
// bounce): their full precision IS the source's depth and must survive. A lossy
// decoder (mp3float/aac) also hands ffmpeg float samples, but that's an artifact of
// decoding, not source precision — those map to 24-bit integer, the widest PCM DJ
// gear actually plays (CDJs refuse 32-bit float WAV), which loses nothing audible
// of a lossy decode.
function sourceDepth(probe: ProbeResult): SampleDepth {
  if (probe.codecName.startsWith('pcm_f')) return { float: true, bits: 32 }
  if (probe.sampleFmt.startsWith('f')) return { float: false, bits: 24 }
  const bits =
    probe.bitsPerRawSample ||
    (probe.sampleFmt.includes('32') ? 32 : probe.sampleFmt.includes('16') ? 16 : 24)
  return { float: false, bits }
}

// Resolves the settings' bit-depth choice against the source: 'source' preserves the
// probed depth exactly, a pinned 16/24 wins over it (padding a narrower source is the
// user's explicit ask, never done silently).
function targetDepth(src: SampleDepth, pin: ConversionQuality['bitDepth']): SampleDepth {
  if (pin === '16') return { float: false, bits: 16 }
  if (pin === '24') return { float: false, bits: 24 }
  return src
}

// Picks a PCM codec for the resolved target depth. Endianness differs by container:
// AIFF stores big-endian samples, WAV (RIFF) little-endian, so the caller passes the
// one its target needs — using the wrong endianness corrupts every sample.
function pcmCodec(depth: SampleDepth, endian: 'be' | 'le'): string {
  if (depth.float) return `pcm_f32${endian}`
  if (depth.bits >= 32) return `pcm_s32${endian}`
  if (depth.bits >= 24) return `pcm_s24${endian}`
  return `pcm_s16${endian}`
}

// Builds the ffmpeg -metadata flags for a target, picking each field's muxer name from
// the TAG_FIELDS registry. A FLAC target (vorbis) gets the Vorbis comment names DJ
// software reads; everything else gets the ID3 names. Fields with no id3 name (rating)
// are written by the TagLib pass instead, so they're skipped here, as are empty values.
function metadataArgs(meta: TrackMetadata, vorbis: boolean): string[] {
  // ffmpeg copies the source's global metadata into the re-encoded file by default,
  // so every managed field is written even when blank: an empty `-metadata name=`
  // clears the value the user emptied in the editor, which would otherwise resurface
  // from the source. Unmanaged frames (anything outside TAG_FIELDS) are still carried
  // over untouched. rating has no `id3`, so it stays preserve-on-empty (TagLib pass).
  // Each field's read aliases are cleared too (LABEL, ORGANIZATION, ALBUMARTIST2…):
  // the reader falls back to them, so a leftover from a previous tagger would both
  // resurface in the editor after the user emptied the field and show up beside our
  // key as a duplicate in other apps. ffmpeg folds a same-spelling key into the
  // written one at read time regardless of case, so only differing spellings need
  // the explicit clear — and the written name itself must be skipped, or the clear
  // would wipe the value set two arguments earlier.
  return TAG_FIELDS.flatMap((field) => {
    if (!field.id3) return []
    const name = vorbis ? (field.vorbis ?? field.id3) : field.id3
    const value = (meta[field.key] ?? '').trim()
    const clears = field.aliases
      .filter((alias) => alias !== name.toLowerCase())
      .flatMap((alias) => ['-metadata', `${alias}=`])
    return ['-metadata', `${name}=${value}`, ...clears]
  })
}

const AIFF_INPUT = /\.aiff?$/i
const MP3_INPUT = /\.mp3$/i
const WAV_INPUT = /\.wav$/i
const FLAC_INPUT = /\.flac$/i
const M4A_OUTPUT = /\.m4a$/i

// The LAME flags each MP3 quality choice maps onto: a fixed CBR bitrate, or a VBR
// preset level for -q:a (V0 ≈ 245 kbps, V2 ≈ 190 kbps).
const MP3_VBR: Partial<Record<Mp3Quality, string>> = { v0: '0', v2: '2' }

// Every quality knob defaults to maximum fidelity: 320 CBR, the source's own bit
// depth and sample rate, ffmpeg's own FLAC effort.
const DEFAULT_QUALITY: ConversionQuality = {
  mp3Quality: '320',
  bitDepth: 'source',
  sampleRate: 'source',
  flacCompression: '5',
}

// The encoder-shaping half of a ConversionPlan — what convertArgs turns into flags.
export interface EncodeArgs {
  codec: string
  bitrate?: string
  // LAME VBR level for -q:a, used instead of a fixed bitrate.
  quality?: string
  // Pins the FLAC/ALAC encoder's input width (-sample_fmt), so a float decode or
  // filter chain can never widen the output past the source/pinned depth.
  sampleFmt?: string
  // Output rate (-ar), present only when the pinned rate differs from the source's.
  sampleRateHz?: number
  // FLAC -compression_level.
  compressionLevel?: string
}

export function convertArgs(
  input: string,
  output: string,
  plan: EncodeArgs,
  meta: TrackMetadata,
  coverPath?: string,
  audioFilter?: string,
  // The staged beatgrid in output-file time, for FLAC outputs: Serato reads its
  // grid from a SERATO_BEATGRID vorbis comment there (GEOB is ID3-only).
  seratoBeatgrid?: Beatgrid,
): string[] {
  // WAV is a single-stream RIFF container, so ffmpeg refuses to mux an attached
  // picture into it ("WAVE files have exactly one stream"). The cover still
  // reaches Apple Music via AppleScript, so a WAV target simply skips the embed.
  // M4A also skips it: the TagLib pass writes the covr atom (with the rest of the
  // iTunes tags ffmpeg's mp4 muxer can't name), so embedding here would be redundant.
  const embedCover =
    coverPath && !WAV_INPUT.test(output) && !M4A_OUTPUT.test(output) ? coverPath : undefined
  const args = ['-y', '-i', input]
  if (embedCover) args.push('-i', embedCover)

  args.push('-map', '0:a')
  if (embedCover) args.push('-map', '1:v', '-c:v', 'copy', '-disposition:v:0', 'attached_pic')

  // Normalization filter (loudnorm / volume), applied to the audio before encoding.
  if (audioFilter) args.push('-af', audioFilter)
  args.push('-c:a', plan.codec)
  if (plan.bitrate) args.push('-b:a', plan.bitrate)
  if (plan.quality) args.push('-q:a', plan.quality)
  if (plan.sampleFmt) args.push('-sample_fmt', plan.sampleFmt)
  if (plan.sampleRateHz) args.push('-ar', String(plan.sampleRateHz))
  if (plan.compressionLevel) args.push('-compression_level', plan.compressionLevel)
  // ID3 flags are meaningless to the mp4 muxer; the m4a tags are finished by the
  // TagLib pass anyway (ffmpeg still maps the generic names it knows to iTunes atoms).
  if (!M4A_OUTPUT.test(output)) args.push('-write_id3v2', '1', '-id3v2_version', '3')
  // Without bitexact every muxer stamps its own advert into the output — an ENCODER
  // Vorbis comment on FLAC, a TSSE frame on MP3, ISFT on RIFF — which users read as
  // metadata junk they never wrote. The flag only silences those stamps: the MP3
  // Info/LAME gapless header survives (verified against ffmpeg 6.1.1).
  args.push('-fflags', '+bitexact')
  args.push(...metadataArgs(meta, FLAC_INPUT.test(output)))
  // FLAC carries the rating as a Vorbis RATING comment (POPM is ID3-only, written
  // by the TagLib pass for the other formats). Steps of 51, matching Traktor.
  // Unlike POPM, this comment round-trips through ffprobe, so an empty field means
  // the file had no (readable) rating or the user erased it — write the empty tag
  // and the leftover is deleted, making "Empty every metadata field" cover the
  // rating too. The other formats stay preserve-on-empty: their POPM is invisible
  // to the probe, so clearing would wipe ratings the user never saw.
  if (output.toLowerCase().endsWith('.flac')) {
    const rating = Number(meta.rating)
    const value = meta.rating?.trim() && rating > 0 ? formatRatingTag(rating) : ''
    args.push('-metadata', `RATING=${value}`)
    if (seratoBeatgrid)
      args.push('-metadata', `SERATO_BEATGRID=${seratoBeatgridVorbis(seratoBeatgrid)}`)
  }
  args.push(output)
  return args
}

export interface ConversionPlan extends EncodeArgs {
  // A reduction to 16 bits from a wider/float pipeline needs TPDF dither at the
  // requantization (ffmpeg's swresample doesn't dither on its own); convertAudio
  // appends the aresample stage when this is set.
  dither?: boolean
  ext: '.aiff' | '.mp3' | '.wav' | '.flac' | '.m4a'
}

// Decides how to render a source into the chosen output format. A source already in
// the target format is bit-identical, so it stream-copies (instant) and the quality
// knobs deliberately don't apply — re-encoding a file already in the format would
// only degrade (lossy) or destroy (in-place edit) the original. Otherwise it
// encodes, pinning the encoder to the resolved bit depth: PCM codecs for AIFF/WAV
// (big-endian/little-endian respectively), -sample_fmt for FLAC/ALAC — without the
// pin those encoders pick their widest format whenever the decode or a normalize
// filter hands them float, which is how a 44.1/16 rip came out 24-bit.
// `normalize` forces a re-encode: applying a loudness/peak filter changes the
// samples, so a stream copy (which would emit the untouched source) is never
// valid — every matching-format shortcut is gated on it being off.
// `forceReencode` is the editor's explicit per-track "Re-encode" action: the one
// path where a same-format source is rendered again (applying the pins) instead
// of taking the metadata-only shortcut. Never set by bulk conversions.
export async function planConversion(
  input: string,
  format: OutputFormat,
  probe: (input: string) => Promise<ProbeResult>,
  normalize = false,
  quality: Partial<ConversionQuality> = {},
  forceReencode = false,
): Promise<ConversionPlan> {
  const q = { ...DEFAULT_QUALITY, ...quality }
  const copyOk = !normalize && !forceReencode
  // One probe shared by every decision below; only spawned when something needs it,
  // so the fast paths (stream copy, plain MP3 encode) stay probe-free.
  let probed: Promise<ProbeResult> | undefined
  const probeOnce = (): Promise<ProbeResult> => (probed ??= probe(input))

  // Output rate flag, present only when the pinned rate differs from the source's —
  // resampling a file already at the target rate would be pure quality-neutral churn.
  const pinnedRate = async (): Promise<number | undefined> => {
    if (q.sampleRate === 'source') return undefined
    const target = Number(q.sampleRate)
    return Number((await probeOnce()).sampleRate) === target ? undefined : target
  }

  if (format === 'mp3') {
    // A source already in MP3 still stream-copies whatever the quality setting says:
    // re-encoding lossy-to-lossy only degrades it.
    if (MP3_INPUT.test(input) && copyOk) return { codec: 'copy', ext: '.mp3' }
    const rate = await pinnedRate()
    const vbr = MP3_VBR[q.mp3Quality]
    return {
      codec: 'libmp3lame',
      ...(vbr ? { quality: vbr } : { bitrate: `${q.mp3Quality}k` }),
      ...(rate ? { sampleRateHz: rate } : {}),
      ext: '.mp3',
    }
  }

  // The lossless targets share the depth/rate resolution: probe the source, resolve
  // the pinned depth against it, and flag the dither a 16-bit requantization needs
  // (any float pipeline — normalize filter, lossy/float decode — or a wider source,
  // or a resample; 16→16 untouched passes through and dither would only add noise).
  const losslessPlan = async (): Promise<
    Pick<ConversionPlan, 'sampleRateHz' | 'dither'> & { depth: SampleDepth }
  > => {
    const src = sourceDepth(await probeOnce())
    const depth = targetDepth(src, q.bitDepth)
    const rate = await pinnedRate()
    const dither =
      depth.bits === 16 &&
      !depth.float &&
      (normalize || src.float || src.bits > 16 || rate !== undefined)
    return {
      ...(rate ? { sampleRateHz: rate } : {}),
      ...(dither ? { dither: true } : {}),
      depth,
    }
  }

  if (format === 'wav') {
    if (WAV_INPUT.test(input) && copyOk) return { codec: 'copy', ext: '.wav' }
    const { depth, ...rest } = await losslessPlan()
    return { codec: pcmCodec(depth, 'le'), ...rest, ext: '.wav' }
  }
  if (format === 'flac') {
    if (FLAC_INPUT.test(input) && copyOk) return { codec: 'copy', ext: '.flac' }
    const { depth, ...rest } = await losslessPlan()
    // FLAC holds integers only (its s32 input writes 24-bit), so a float source
    // lands on the encoder's widest width rather than keeping float.
    return {
      codec: 'flac',
      sampleFmt: !depth.float && depth.bits <= 16 ? 's16' : 's32',
      compressionLevel: q.flacCompression,
      ...rest,
      ext: '.flac',
    }
  }
  if (format === 'alac') {
    // No stream-copy shortcut: an .m4a source may hold lossy AAC, and telling it apart
    // from ALAC needs a codec probe — while an ALAC re-encode is lossless regardless,
    // so always encoding is correct, just slower.
    const { depth, ...rest } = await losslessPlan()
    return {
      codec: 'alac',
      sampleFmt: !depth.float && depth.bits <= 16 ? 's16p' : 's32p',
      ...rest,
      ext: '.m4a',
    }
  }
  if (AIFF_INPUT.test(input) && copyOk) return { codec: 'copy', ext: '.aiff' }
  const { depth, ...rest } = await losslessPlan()
  return { codec: pcmCodec(depth, 'be'), ...rest, ext: '.aiff' }
}

// Resolves the audio filter for the chosen normalization, running the required
// measurement pass first: a two-pass linear loudnorm for the loudness target, or
// volumedetect + a constant gain for peak. Returns null (no filter) for mode
// 'none' and whenever the measurement can't be parsed, so a measurement failure
// degrades to a plain conversion instead of aborting it.
// The measurement decodes the whole file — as long again as the conversion — so
// it is memoized like the other analyses (path + mtime key, null never pinned):
// re-converting an unchanged track pays for it once. Only the measurement is
// cached, never the filter string, which also depends on the output sample rate.
export async function normalizeFilter(
  input: string,
  cfg: NormalizeConfig,
  sampleRate?: number,
  // The click-repair stage the conversion will run before this filter. Threaded into
  // every measurement so the gain is sized on the repaired audio — a full-scale click
  // would otherwise anchor the peak/true-peak reading and leave the track short of its
  // target. The measurement changes with it, so it also suffixes each cache namespace.
  declick?: DeclickMode,
  // The silence trim the conversion will run first, threaded in for the same reason:
  // a loud needle-drop in a trimmed-away head would otherwise anchor the reading.
  trim?: TrimRange,
): Promise<string | null> {
  if (cfg.mode === 'none') return null
  const trimAf = trimFilter(trim) ?? undefined
  const declickAf = declickFilter(declick ?? 'off') ?? undefined
  const prefilter = [trimAf, declickAf].filter(Boolean).join(',') || undefined
  // Trimmed or repaired audio is a different measurement input, so each combination
  // gets its own cache entry; the bare namespace stays untouched for plain conversions.
  const ns = (base: string): string => {
    const trimmed = trimAf ? `-trim-${trim?.startSec ?? 0}-${trim?.endSec ?? 'end'}` : ''
    const declicked = declickAf ? `-declick-${declick}` : ''
    return `${base}${trimmed}${declicked}`
  }
  if (cfg.mode === 'peak') {
    // The Audacity-style options (per-channel DC removal, independent channel
    // gains) need per-channel figures volumedetect can't give, so they measure
    // with astats instead. Same fact-about-the-file-alone caching as below.
    if (cfg.peakRemoveDc || cfg.peakPerChannel) {
      const channels = await cachedAnalysis(ns('astats-channels-v1'), input, async () => {
        const { stderr } = await run(ffmpegPath, astatsArgs(input, prefilter), {
          maxBuffer: 1024 * 1024 * 16,
        })
        return parseAstatsChannels(stderr)
      })
      return channels === null ? null : peakChannelFilter(cfg, channels)
    }
    // Peak mode is a constant-gain `volume` filter, which doesn't resample, so it
    // needs no rate restoration. The measured peak is a fact about the file alone,
    // so one namespace serves every target.
    const max = await cachedAnalysis(ns('volumedetect-v1'), input, async () => {
      const { stderr } = await run(ffmpegPath, volumedetectArgs(input, prefilter), {
        maxBuffer: 1024 * 1024 * 16,
      })
      return parseMaxVolume(stderr)
    })
    return max === null ? null : volumeFilter(peakGainDb(cfg.peakDb, max))
  }
  // The requested I/TP ride in the measurement filter and target_offset depends on
  // them, so the key carries both — same file, different target re-measures. The
  // fixed LRA is baked into the version suffix: bump it if LOUDNORM_LRA changes.
  const measured = await cachedAnalysis(
    ns(`loudnorm-measure-v1-I${cfg.targetLufs}-TP${cfg.truePeakDb}`),
    input,
    async () => {
      const { stderr } = await run(ffmpegPath, loudnormArgs(input, cfg, prefilter), {
        maxBuffer: 1024 * 1024 * 16,
      })
      return parseLoudnorm(stderr)
    },
  )
  if (!measured) return null
  // A reachable target normalizes linearly (dynamics intact); a target too loud for a
  // constant gain (the club preset on most material) would otherwise land short, so
  // push the gain to target and limit the overs to the ceiling instead.
  return reachesTargetLinearly(cfg, measured)
    ? loudnormFilter(cfg, measured, sampleRate)
    : limitedLoudnormFilter(cfg, measured, sampleRate)
}

// The cue re-anchoring a trim demands, in Traktor's millisecond units: positions
// move back by the head cut and clamp to the trimmed length when the tail was
// cut too. Undefined while no trim filter ran — the carried frames then stay
// byte-exact, as they always did for plain re-encodes and constant gains.
function cueShiftFor(
  trim: TrimRange | undefined,
  active: boolean,
): { shiftMs: number; maxMs?: number } | undefined {
  if (!active || !trim) return undefined
  const startSec = trim.startSec ?? 0
  return {
    shiftMs: Math.round(startSec * 1000),
    maxMs: trim.endSec !== undefined ? Math.round((trim.endSec - startSec) * 1000) : undefined,
  }
}

// Where the staged grid lands in the output's timeline: a trim that actually ran
// cut the head, so the anchor shifts back by it, folded onto the same grid's
// first surviving beat when the cut passes it — the tag-side twin of the cue
// re-anchoring above and of exportAnchorSec in the renderer.
function outputBeatgrid(
  grid: Beatgrid | undefined,
  trim: TrimRange | undefined,
  trimApplied: boolean,
): Beatgrid | undefined {
  if (!grid) return undefined
  const cut = trimApplied ? (trim?.startSec ?? 0) : 0
  if (cut === 0) return grid
  const anchor = grid.anchorSec - cut
  return { bpm: grid.bpm, anchorSec: anchor < 0 ? snapAnchor(anchor, grid.bpm) : anchor }
}

// The temp file a conversion renders into before the rename over the final output.
// Unique per call: bulk runs convert several tracks in parallel, and two tracks whose
// metadata resolves to the same output name would otherwise share one deterministic
// temp path — both ffmpeg processes writing it at once, corruption landing as a
// "successful" conversion. Beside the output (same volume, so the rename stays atomic)
// and with the real extension last (ffmpeg picks its muxer from it). Dot-prefixed so
// nothing watching the folder — Finder, Surco's own new-tracks watcher, another
// app's auto-import — ever sees the half-written file; expand.ts additionally skips
// the ".tmp-xxxxxxxx" pattern for Windows and for temps left by older versions.
export function convertTmpPath(output: string, ext: string): string {
  const dir = dirname(output)
  const name = basename(output).replace(
    new RegExp(`\\${ext}$`, 'i'),
    `.tmp-${randomUUID().slice(0, 8)}${ext}`,
  )
  return join(dir, `.${name}`)
}

// The TPDF-dithered requantization a reduction to 16 bits needs: swresample only
// dithers when asked, and a truncated float chain would otherwise leave harmonic
// quantization distortion where dither leaves benign noise. triangular_hp keeps the
// dither energy up where it's least audible.
const DITHER_FILTER = 'aresample=out_sample_fmt=s16:dither_method=triangular_hp'

export async function convertAudio(
  input: string,
  output: string,
  format: OutputFormat,
  meta: TrackMetadata,
  coverPath?: string,
  normalize?: NormalizeConfig,
  removeCover?: boolean,
  quality?: Partial<ConversionQuality>,
  forceReencode?: boolean,
  // Learns the encode's child process the moment it spawns, so a cancel can kill
  // a conversion already in flight instead of only skipping ones not yet started.
  // Never fired for the stream-copy shortcut (copyFile spawns nothing) or the
  // measurement passes (normalizeFilter) — only the real encode below.
  onChild?: (child: { kill: (signal: string) => void }) => void,
  // Learns the temp path the instant it's chosen, before anything writes to it —
  // the caller records it so a crash or force-quit before the rename/cleanup
  // below still leaves a trail the next launch can sweep (see tmpManifest.ts).
  onTmp?: (path: string) => void,
  // macOS-only opt-in (Settings → Artwork): prepend the ID3v2 header that makes
  // Finder show the cover on a FLAC output (see flacFinderCover.ts). The caller
  // resolves the setting and the platform; this only sees the final verdict.
  finderCovers?: boolean,
  // Vinyl click repair, applied ahead of the normalize/dither stages so any gain
  // below is sized on the repaired audio. Forces a re-encode like normalize.
  declick?: DeclickMode,
  // Leading/trailing silence trim, the first filter stage: the seconds the user
  // confirmed in the editor, cut exactly. Forces a re-encode like normalize.
  trim?: TrimRange,
  // The staged beatgrid (original-file seconds): written into the output as
  // Serato's grid tag — GEOB on MP3/AIFF, a vorbis comment on FLAC — offset by
  // the trim exactly like the Traktor cues.
  beatgrid?: Beatgrid,
): Promise<{ normalizeSkipped: boolean; declickedSamples?: number }> {
  // We always write to a temp file and rename it over the target, so
  // re-processing a file that already lives in the output folder (input path ===
  // output path) overwrites it atomically instead of failing with ffmpeg's
  // "Output same as Input" error.
  // Re-encoding through ffmpeg drops Traktor's GEOB cues regardless, so the gain
  // filter only ever rides the encode path — planConversion is told to skip the
  // stream-copy shortcuts when normalizing.
  const normalizing = normalize !== undefined && normalize.mode !== 'none'
  const trimAf = trimFilter(trim) ?? undefined
  const declickAf = declickFilter(declick ?? 'off') ?? undefined
  // The loudnorm sampleRate read and planConversion's PCM-width read probe the same
  // file, so share one probe between them instead of spawning ffprobe twice per
  // normalized AIFF/WAV conversion.
  let probed: Promise<ProbeResult> | undefined
  const probeOnce = (file: string): Promise<ProbeResult> => (probed ??= probeAudio(file))
  // loudnorm emits 192 kHz; pass the rate the filter should resample back to — the
  // pinned output rate when the settings set one, else the source's own rate.
  // Only probed for the loudnorm path — peak mode's volume filter keeps the rate.
  const pinnedRateHz =
    quality?.sampleRate && quality.sampleRate !== 'source' ? Number(quality.sampleRate) : undefined
  const sampleRate =
    normalize?.mode === 'loudness'
      ? (pinnedRateHz ?? (Number((await probeOnce(input)).sampleRate) || undefined))
      : undefined
  const normalizeAf = normalizing
    ? ((await normalizeFilter(input, normalize, sampleRate, declick, trim)) ?? undefined)
    : undefined
  // Normalization was asked for but its measurement pass failed (normalizeFilter returned
  // null), so the conversion proceeds un-normalized rather than failing outright — the
  // caller surfaces this so the user knows the loudness target wasn't actually applied.
  const normalizeSkipped = normalizing && normalizeAf === undefined
  // Trim and declick alter the samples exactly like a normalize filter, so they
  // force the same re-encode: a stream copy would emit the untouched source.
  const plan = await planConversion(
    input,
    format,
    probeOnce,
    normalizing || declickAf !== undefined || trimAf !== undefined,
    quality,
    forceReencode ?? false,
  )
  const { codec, dither, ext } = plan
  // The trim runs first (every later stage works on the kept audio only), click
  // repair next — the gains below were measured through both — and the dither
  // stage last, right where the float chain is quantized back to 16 bits.
  const audioFilter =
    [trimAf, declickAf, normalizeAf, dither ? DITHER_FILTER : undefined]
      .filter(Boolean)
      .join(',') || undefined
  // trimAf decides whether the trim actually ran (a stream copy never trims).
  const outGrid = outputBeatgrid(beatgrid, trim, trimAf !== undefined)
  const tmp = convertTmpPath(output, ext)
  onTmp?.(tmp)
  // adeclick reports its repaired-sample total on the encode's stderr; undefined
  // when declick is off so "not run" and "ran, found 0" stay distinct upstream.
  let declickedSamples: number | undefined

  try {
    if (codec === 'copy' && preservesCuesInPlace(ext)) {
      // Source already in the target format: copy the bytes verbatim and edit the
      // tag in place (see tags.ts) instead of re-muxing through ffmpeg, which
      // would drop Traktor's cue/beatgrid GEOB frame even on a stream copy.
      // TagLib's save is synchronous and rewrites the whole file when the tag
      // grows, so every tag pass below runs in the worker thread.
      // COPYFILE_FICLONE clones instead of copying when source and destination
      // share a filesystem that supports it (APFS: instant, copy-on-write, any
      // size) and silently falls back to a byte copy otherwise (other
      // filesystems, or an output folder on a different volume).
      await copyFile(input, tmp, fsConstants.COPYFILE_FICLONE)
      await runInWorker({ type: 'writeTags', file: tmp, meta, coverPath, removeCover, beatgrid: outGrid })
    } else {
      const { stderr } = await run(
        ffmpegPath,
        convertArgs(input, tmp, plan, meta, coverPath, audioFilter, ext === '.flac' ? outGrid : undefined),
        {
          maxBuffer: 1024 * 1024 * 32,
          onChild,
        },
      )
      if (declickAf) declickedSamples = parseDeclickedSamples(String(stderr)) ?? undefined
      if (ext === '.wav' || ext === '.m4a') {
        // RIFF rejects an attached-picture stream, so convertArgs can't embed the
        // cover and drops tags with no RIFF-INFO field (grouping). TagLib writes a
        // full ID3v2 tag into a WAV "id3 " chunk instead, which carries the artwork
        // and grouping — and which ffmpeg reads back as a video stream on re-import.
        // M4A takes the same pass: TagLib writes the iTunes atoms (bpm, key, cover)
        // that ffmpeg's mp4 muxer has no -metadata names for.
        await runInWorker({ type: 'writeTags', file: tmp, meta, coverPath })
      } else if (meta.rating?.trim() && (ext === '.mp3' || ext === '.aiff')) {
        // ffmpeg can't emit a POPM frame, so a re-encoded MP3/AIFF needs a TagLib
        // pass to write the Traktor rating. Only done when there's a rating, to
        // avoid a second tag pass on every conversion. cueSource folds the cue
        // carry-over (below) into this same save, so the rating never costs a
        // second whole-file rewrite on top of it.
        await runInWorker({
          type: 'writeTags',
          file: tmp,
          meta,
          coverPath,
          cueSource: input,
          cueShift: cueShiftFor(trim, trimAf !== undefined),
          beatgrid: outGrid,
        })
      }
      // Any re-encode through ffmpeg drops Traktor's cue/beatgrid frames — a
      // plain format change just as much as a normalizing gain pass. Neither moves
      // the cues in time (a constant gain doesn't, and the decoded sample timeline
      // is preserved across formats), so carry the frames over from the source for
      // the ID3 containers they round-trip through, restoring cues on every encode
      // rather than only when normalizing. A trim DOES move the audio under them,
      // so the shift re-anchors each stored position (see tags.ts). A rated
      // MP3/AIFF already carried them in its writeTags pass above.
      else if (preservesCuesInPlace(ext))
        await runInWorker({
          type: 'copyCueFrames',
          source: input,
          dest: tmp,
          shift: cueShiftFor(trim, trimAf !== undefined),
          beatgrid: outGrid,
        })
    }
    // Last touch before the rename so the header rides the same atomic landing.
    // Only when there's a cover to show — the header exists solely for Finder's
    // thumbnail, so a coverless (or cover-removed) FLAC stays fully standard.
    if (finderCovers && ext === '.flac' && coverPath && !removeCover)
      await runInWorker({ type: 'prependFlacId3', file: tmp, meta, coverPath })
    await rename(tmp, output)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
  return { normalizeSkipped, declickedSamples }
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

// Renders the 20 s "hear what gets removed" audition for the given repair mode into
// `output`: a WAV holding only what the repair would take out (declickRemovedArgs),
// plus the excerpt's touched share off adeclick's stderr — the RX-style caption
// that tells the user whether the near-silence they hear means "clean rip" or
// "nothing rendered". null when the mode is off — nothing would be removed,
// nothing to audition. The caller owns the output path (a quit-swept preview temp).
// Timed out like the analysis reads: it's an interactive request, and a stalled
// mount must drop it rather than wedge the button forever.
export async function renderDeclickRemoved(
  input: string,
  output: string,
  mode: DeclickMode,
): Promise<{ path: string; share: number | null } | null> {
  const args = declickRemovedArgs(input, output, mode, previewWindow(await probeDuration(input)))
  if (!args) return null
  const { stderr } = await run(ffmpegPath, args, {
    maxBuffer: 1024 * 1024 * 16,
    timeout: ANALYSIS_TIMEOUT_MS,
  })
  return { path: output, share: parseDeclickedShare(String(stderr)) }
}

// Transcodes an AIFF into a WAV the player can decode, preserving the source bit
// depth exactly (the player only needs to play it, but losing precision for a
// preview would still misrepresent the rip).
export async function transcodeAiffToWav(input: string, output: string): Promise<void> {
  const codec = pcmCodec(sourceDepth(await probeAudio(input)), 'le')
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
    await run(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        input,
        '-lavfi',
        // Emit a grayscale intensity map (loud = bright) and let the renderer recolor it
        // with theme tokens, so the same image follows both the light and dark Tokyo Night
        // palettes. cividis grays to a monotonic ramp, so its luminance still tracks
        // amplitude cleanly. Bump the cache namespace when this changes so images cached
        // under the old palette regenerate instead of showing stale colors.
        //
        // gain=1 (not 2) with the default 120 dB range, mirroring Spek's own −120…0 dBFS
        // map (spek-fft.cc emits 10·log10(power); spek-spectrogram.cc spans LRANGE=−120 to
        // URANGE=0). gain=2 doubled the intensity, lifting the quantization noise above a
        // codec wall (~16 kHz on a fake 320) from black into the renderer's mid-blue ramp,
        // so a wall the file does not pass read as full band. But narrowing the range to
        // hide that noise (an earlier 60 dB attempt) also clipped the genuine −60…−90 dB HF
        // transients Spek shows reaching ~22 kHz. The honest fix keeps the full range here
        // and fades the bottom of the recolor ramp to the panel instead (see
        // spectrumColors.ts), exactly how Spek's palette sinks its low end to black.
        'showspectrumpic=s=1000x320:legend=0:color=cividis:gain=1,format=gray',
        out,
      ],
      { timeout: ANALYSIS_TIMEOUT_MS },
    )
    const buf = await readFile(out)
    return `data:image/png;base64,${buf.toString('base64')}`
  } finally {
    await unlink(out).catch(() => {})
  }
}

export interface CoverProcessOpts {
  maxSize: number
  square: boolean
  upscale: boolean
}

// The -vf chain a cover embed runs through. By default the size cap only shrinks
// (the min() clamp — enlarging would invent pixels nobody asked for); `upscale`
// turns the cap into a target so smaller art is scaled up to it too, which with
// `square` lands every cover on exactly target×target. Upscaling needs a target,
// so it is ignored when maxSize is 0 ("no limit", internally the 4000 sentinel).
// The square crop runs first: cropping after an upscale would cut away pixels the
// scale just paid for and land below target.
export function coverFilter(opts: CoverProcessOpts): string {
  const max = opts.maxSize > 0 ? opts.maxSize : 4000
  const scale =
    opts.upscale && opts.maxSize > 0
      ? `scale=${max}:${max}:force_original_aspect_ratio=decrease:flags=lanczos`
      : `scale='min(${max},iw)':'min(${max},ih)':force_original_aspect_ratio=decrease`
  return opts.square ? `crop='min(iw,ih)':'min(iw,ih)',${scale}` : scale
}

export async function processCover(input: string, opts: CoverProcessOpts): Promise<string> {
  const vf = coverFilter(opts)
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
// (file=-) tagged with a surcoband=<freq>x<width> metadata key, then mixes the
// branches so ffmpeg has a single output to render. The width is part of the
// tag because the coarse (1 kHz) and fine (500 Hz) probes share centre
// frequencies — 13000x1000 and 13000x500 are different measurements.
//
// It writes no temp files on purpose. An ametadata file= path like
// C:\Users\...\x.txt is unparseable by ffmpeg's filtergraph (':' separates
// options and '\' escapes, and no escaping is reliable), which is exactly what
// broke on Windows. Printing to stdout sidesteps filesystem paths entirely; the
// surcoband tag lets analyzeCutoff split the merged stream back per band.
export interface BandSpec {
  freqHz: number
  widthHz: number
}

export function cutoffFilter(specs: BandSpec[]): string {
  const branches = specs
    .map(
      ({ freqHz, widthHz }, i) =>
        `[b${i}]ametadata=mode=add:key=surcoband:value=${freqHz}x${widthHz},` +
        `bandpass=f=${freqHz}:width_type=h:w=${widthHz},astats=metadata=1:reset=0,` +
        `ametadata=mode=print:file=-[o${i}]`,
    )
    .join(';')
  return (
    `[0:a]asetnsamples=n=1048576:p=0,asplit=${specs.length}${specs.map((_, i) => `[b${i}]`).join('')};` +
    `${branches};${specs.map((_, i) => `[o${i}]`).join('')}amix=inputs=${specs.length}`
  )
}

// Pairs each band's "<freq>x<width>" tag with its cumulative RMS from the
// tagged stdout the filter prints. Within a band's block the surcoband tag
// prints just before its Overall RMS, so we attribute each RMS to the band
// tagged most recently; astats runs with reset=0, so the last block per band
// carries the whole-file level — last write wins.
export function parseBands(stdout: string): Map<string, number> {
  const rms = new Map<string, number>()
  let band: string | null = null
  for (const line of stdout.split('\n')) {
    const tag = line.match(/surcoband=(\d+x\d+)/)
    if (tag) {
      band = tag[1]
      continue
    }
    const level = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+)/)
    if (level && band !== null) rms.set(band, Number(level[1]))
  }
  return rms
}

// Measures the energy in each high-frequency band in a single decode (asplit
// into one bandpass→astats branch per band, coarse and fine probes together)
// and hands the per-band RMS to detectCutoff, which spots the codec's lowpass
// and the saw-tooth of reconstructed highs.
export async function analyzeCutoff(
  input: string,
  sampleRateHz: number,
): Promise<CutoffResult & { upsampled: boolean }> {
  const nyquist = sampleRateHz / 2
  const freqs = bandFrequencies(nyquist)
  if (freqs.length < 2)
    return { cutoffHz: nyquist, processed: false, hasKnee: false, upsampled: false }
  const fineFreqs = fineBandFrequencies(nyquist)
  // Only worth probing the 22.05 kHz wall when Nyquist clears the upper band; on a
  // native 44.1 kHz file there is no headroom above it to read.
  const probesUpsample = nyquist >= UPSAMPLE_MIN_NYQUIST_HZ

  const specs: BandSpec[] = [
    ...freqs.map((freqHz) => ({ freqHz, widthHz: BAND_WIDTH_HZ })),
    ...fineFreqs.map((freqHz) => ({ freqHz, widthHz: FINE_BAND_WIDTH_HZ })),
    ...(probesUpsample
      ? [UPSAMPLE_PROBE_BELOW_HZ, UPSAMPLE_PROBE_ABOVE_HZ].map((freqHz) => ({
          freqHz,
          widthHz: FINE_BAND_WIDTH_HZ,
        }))
      : []),
  ]
  const { stdout } = await run(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      input,
      '-filter_complex',
      cutoffFilter(specs),
      '-f',
      'null',
      '-',
    ],
    { maxBuffer: 1024 * 1024 * 16, timeout: ANALYSIS_TIMEOUT_MS },
  )
  const rms = parseBands(stdout)
  const bands = freqs.map((freqHz) => ({
    freqHz,
    rmsDb: rms.get(`${freqHz}x${BAND_WIDTH_HZ}`) ?? -Infinity,
  }))
  const fine = fineFreqs.map((freqHz) => ({
    freqHz,
    rmsDb: rms.get(`${freqHz}x${FINE_BAND_WIDTH_HZ}`) ?? -Infinity,
  }))
  const upsampled =
    probesUpsample &&
    detectUpsample(
      rms.get(`${UPSAMPLE_PROBE_BELOW_HZ}x${FINE_BAND_WIDTH_HZ}`) ?? -Infinity,
      rms.get(`${UPSAMPLE_PROBE_ABOVE_HZ}x${FINE_BAND_WIDTH_HZ}`) ?? -Infinity,
    )
  return { ...detectCutoff(bands, nyquist, fine), upsampled }
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
    { maxBuffer: 1024 * 1024 * 16, timeout: ANALYSIS_TIMEOUT_MS },
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

// Decodes a file to mono f32le PCM at the given rate (optionally just the opening
// `seconds`) and returns it as a Float32Array. ffmpeg emits raw floats so there is
// nothing to parse, but the bytes land in Node's shared Buffer pool, whose offset need
// not be 4-byte aligned — so they are copied out before being viewed as floats. Each
// analysis decoder below differs only in rate, window and buffer ceiling.
async function decodePcm(
  input: string,
  opts: { sampleRate: number; startSec?: number; seconds?: number; maxBufferMb: number },
): Promise<Float32Array> {
  const args = ['-hide_banner', '-loglevel', 'error']
  // Input seek (-ss before -i): ffmpeg jumps straight to the window instead of
  // decoding its way there — what keeps the zoomed re-decode interactive.
  if (opts.startSec !== undefined && opts.startSec > 0) args.push('-ss', String(opts.startSec))
  args.push('-i', input)
  if (opts.seconds !== undefined) args.push('-t', String(opts.seconds))
  args.push('-ac', '1', '-ar', String(opts.sampleRate), '-f', 'f32le', '-')
  const { stdout } = await run(ffmpegPath, args, {
    encoding: 'buffer',
    maxBuffer: 1024 * 1024 * opts.maxBufferMb,
    timeout: ANALYSIS_TIMEOUT_MS,
  })
  const bytes = stdout.length - (stdout.length % 4)
  const pcm = new Uint8Array(bytes)
  pcm.set(stdout.subarray(0, bytes))
  return new Float32Array(pcm.buffer)
}

// The opening four minutes at a low rate for the tempo and key detectors. Four minutes
// pins a steady DJ tempo (and the prevailing key) while bounding the buffer (~10 MB)
// regardless of file length; mono because both are properties of the mix, not of either
// channel.
// Selecting a track fires audio:bpm and audio:key together, and both decode the exact
// same 11025/240s PCM — two ffmpeg passes where one will do. Single-flight the decode:
// concurrent callers for the same file share the in-flight promise, and the entry is
// dropped on settle so a later re-decode (e.g. after the file changes) isn't pinned.
const inFlightAnalysisPcm = new Map<string, Promise<Float32Array>>()
function decodeAnalysisPcm(input: string): Promise<Float32Array> {
  const pending = inFlightAnalysisPcm.get(input)
  if (pending) return pending
  const decode = decodePcm(input, { sampleRate: TEMPO_SAMPLE_RATE, seconds: 240, maxBufferMb: 16 })
  inFlightAnalysisPcm.set(input, decode)
  const clear = (): void => {
    inFlightAnalysisPcm.delete(input)
  }
  decode.then(clear, clear)
  return decode
}

// The detectors crunch hundreds of FFTs in tight JS loops — run on the main process
// they freeze IPC, the menu and the surco:// audio stream for the whole analysis, so
// both ship their PCM to the worker thread. The buffer is structure-cloned by postMessage
// (not transferred), so the shared single-flight decode stays valid for the other detector.
export async function measureBpm(input: string): Promise<BpmResult | null> {
  const pcm = await decodeAnalysisPcm(input)
  return runInWorker<BpmResult | null>({ type: 'bpm', pcm, sampleRate: TEMPO_SAMPLE_RATE })
}

export async function measureKey(input: string): Promise<KeyResult | null> {
  const pcm = await decodeAnalysisPcm(input)
  return runInWorker<KeyResult | null>({ type: 'key', pcm, sampleRate: TEMPO_SAMPLE_RATE })
}

export async function measureBeatgrid(input: string): Promise<BeatgridResult | null> {
  const pcm = await decodeAnalysisPcm(input)
  return runInWorker<BeatgridResult | null>({ type: 'beatgrid', pcm, sampleRate: TEMPO_SAMPLE_RATE })
}

// Native 44.1 kHz mono PCM for the HF-shelf probe — unlike the tempo/key decoder's
// downsample, the shelf lives at 17-22 kHz, which a low analysis rate discards.
// Four minutes captures the shelf the whole-file average shows (a short window can
// miss it) while bounding the buffer: 44.1 kHz × 240 s mono ≈ 42 MB, hence 64 MB.
const SHELF_SAMPLE_RATE = 44100
function decodeShelfPcm(input: string): Promise<Float32Array> {
  // 44.1 kHz × 240 s mono ≈ 42 MB, hence the 64 MB ceiling.
  return decodePcm(input, { sampleRate: SHELF_SAMPLE_RATE, seconds: 240, maxBufferMb: 64 })
}

// Estimated audible clicks for the editor's repair section (see clickDetect.ts).
// Native rate, mono: a stylus click is 1-9 samples wide, so any downsample smears it
// away. Capped at eight minutes — beyond a typical vinyl side; the count is worded
// as an estimate — bounding the buffer at ~85 MB. One O(n) pass, no FFT, so unlike
// bpm/key/shelf it runs inline instead of shipping the buffer to the worker.
export async function countTrackClicks(input: string): Promise<number> {
  const pcm = await decodePcm(input, {
    sampleRate: SHELF_SAMPLE_RATE,
    seconds: 480,
    maxBufferMb: 96,
  })
  return countClicks(pcm, SHELF_SAMPLE_RATE)
}

// Two signals the biquad codec-lowpass pass is blind to, both read off the same flat
// FFT bands (see hfShelf.ts): a flat HF shelf held to Nyquist (software-regenerated
// highs), and a codec knee whose sharp wall the biquad's wide skirts smear below its
// threshold. Each is the source's real ceiling in Hz, or null. Scoped to native 44.1 kHz
// — where the thresholds were calibrated and the band layout reaches Nyquist. Higher
// rates are the upsample probe's job, and resampling a lower rate up to 44.1 would forge
// its own 22 kHz wall. The heavy FFT runs in the worker so it never freezes IPC; the
// buffer is transferred, not copied.
export async function analyzeShelf(
  input: string,
  sampleRateHz: number,
): Promise<{ shelfCutoffHz: number | null; kneeCutoffHz: number | null }> {
  if (sampleRateHz !== SHELF_SAMPLE_RATE) return { shelfCutoffHz: null, kneeCutoffHz: null }
  const pcm = await decodeShelfPcm(input)
  const bands = await runInWorker<number[]>({ type: 'shelf', pcm, sampleRate: SHELF_SAMPLE_RATE }, [
    pcm.buffer as ArrayBuffer,
  ])
  return {
    shelfCutoffHz: detectFlatShelf(
      bands,
      SHELF_BAND_START_HZ,
      SHELF_BAND_WIDTH_HZ,
      sampleRateHz / 2,
    ),
    kneeCutoffHz: detectFftKnee(bands, SHELF_BAND_START_HZ, SHELF_BAND_WIDTH_HZ),
  }
}

interface SpectrumDeps {
  probe: (input: string) => Promise<{ sampleRate: string }>
  spectrogram: (input: string) => Promise<string>
  cutoff: (input: string, sampleRateHz: number) => Promise<CutoffResult & { upsampled: boolean }>
  shelf: (
    input: string,
    sampleRateHz: number,
  ) => Promise<{ shelfCutoffHz: number | null; kneeCutoffHz: number | null }>
}

interface SpectrumBuild {
  image: string
  cutoffHz: number | null
  sampleRateHz: number
  processed: boolean
  hasKnee: boolean
  upsampled: boolean
  cutoffError?: unknown
  shelfError?: unknown
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
  const [imageR, cutoffR, shelfR] = await Promise.allSettled([
    deps.spectrogram(input),
    deps.cutoff(input, sampleRateHz),
    deps.shelf(input, sampleRateHz),
  ])
  if (imageR.status === 'rejected') throw imageR.reason
  const cutoff = cutoffR.status === 'fulfilled' ? cutoffR.value : null
  // The flat-shelf probe is best-effort and independent of the image, so a failure
  // is logged (below) but neither discards the image nor blocks caching the rest.
  const shelf = shelfR.status === 'fulfilled' ? shelfR.value : null
  const shelfCutoffHz = shelf?.shelfCutoffHz ?? null
  // A flat shelf is reprocessed (its own verdict), so the FFT knee only adds a signal
  // when nothing else already explains the spectrum: a real codec wall the biquad pass
  // smeared below its knee threshold.
  const processed = (cutoff?.processed ?? false) || shelfCutoffHz !== null
  const kneeCutoffHz = !processed ? (shelf?.kneeCutoffHz ?? null) : null
  return {
    image: imageR.value,
    // Prefer the codec pass's own cutoff when it found manipulation; otherwise fall
    // back to the shelf elbow, since the codec pass reads a flat shelf as reaching
    // Nyquist and would draw the line there, then to the FFT knee (the real wall the
    // biquad smeared past). Null only when the codec pass failed and nothing else fired.
    cutoffHz:
      cutoff?.processed === true
        ? cutoff.cutoffHz
        : shelfCutoffHz !== null
          ? shelfCutoffHz
          : kneeCutoffHz !== null
            ? Math.min(kneeCutoffHz, cutoff?.cutoffHz ?? kneeCutoffHz)
            : (cutoff?.cutoffHz ?? null),
    sampleRateHz,
    processed,
    hasKnee: (cutoff?.hasKnee ?? false) || kneeCutoffHz !== null,
    upsampled: cutoff?.upsampled ?? false,
    cutoffError: cutoffR.status === 'rejected' ? cutoffR.reason : undefined,
    shelfError: shelfR.status === 'rejected' ? shelfR.reason : undefined,
  }
}

// low-rate mono PCM for the editor waveform — the strip spans the full length (no
// `seconds` window), so a truncated envelope would draw a track that ends early. The
// 4 kHz rate keeps even a 2-hour mix around 115 MB, inside the 128 MB ceiling.
function decodeWaveformPcm(input: string): Promise<Float32Array> {
  return decodePcm(input, { sampleRate: WAVEFORM_SAMPLE_RATE, maxBufferMb: 128 })
}

// A slice of the track re-decoded at full waveform fidelity for the strips' deep
// zoom: past the global envelope's resolution, the visible window is decoded on
// demand (DAW-style) instead of stretching the 8192 overview buckets into blocks.
// Seek + short window keeps it a sub-second ffmpeg call; the renderer caches and
// quantizes windows so scrolling reuses them.
export async function measureWaveformWindow(
  input: string,
  startSec: number,
  durSec: number,
  buckets: number,
): Promise<{ peaks: number[] } | null> {
  const samples = await decodePcm(input, {
    sampleRate: WAVEFORM_SAMPLE_RATE,
    startSec,
    seconds: durSec,
    maxBufferMb: 32,
  })
  if (samples.length === 0) return null
  return { peaks: computePeaks(samples, buckets) }
}

// Per-channel scan at the native rate and channel count: true-clipping flags plus
// each channel's own envelope for the split L/R view. The 4 kHz waveform decode can
// see neither — resampling smears the pinned flat tops and the mono downmix averages
// a one-channel rail away — which is how near-ceiling masters used to paint solid
// red while Audacity showed sparse marks. Streamed via spawn because a native stereo
// decode of a long mix is gigabytes of f32, far past any exec buffer, while the scan
// itself keeps only per-block accumulators.
async function scanChannels(
  input: string,
): Promise<{ clipped: boolean[]; channels: ChannelWave[] }> {
  const { channels } = await probeAudio(input)
  const scan = createChannelScan(Math.max(1, channels))
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      ['-hide_banner', '-loglevel', 'error', '-i', input, '-map', '0:a:0', '-f', 'f32le', '-'],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: ANALYSIS_TIMEOUT_MS },
    )
    if (child.pid !== undefined) {
      try {
        setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
      } catch {
        // Same best-effort niceness as niceDecode: normal priority is a fine fallback.
      }
    }
    // stdout chunks split at arbitrary byte offsets, so carry each chunk's tail bytes
    // into the next before viewing as f32 — and copy out of Node's shared Buffer pool,
    // whose offsets need not be 4-byte aligned (same dance as decodePcm).
    let tail = Buffer.alloc(0)
    child.stdout.on('data', (chunk: Buffer) => {
      const data = tail.length > 0 ? Buffer.concat([tail, chunk]) : chunk
      const usable = data.length - (data.length % 4)
      tail = Buffer.from(data.subarray(usable))
      if (usable === 0) return
      const aligned = new Uint8Array(usable)
      aligned.set(data.subarray(0, usable))
      scan.push(new Float32Array(aligned.buffer))
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(scan.finish())
      else reject(new Error(`channel scan exited with code ${code}`))
    })
  })
}

export async function measureWaveform(input: string): Promise<WaveformResult | null> {
  // Best-effort clip marks and channel lanes: a failed scan only loses those,
  // never the strip.
  const [samples, scan] = await Promise.all([
    decodeWaveformPcm(input),
    scanChannels(input).catch(() => null),
  ])
  // Zero decoded samples means ffmpeg produced nothing (empty or undecodable
  // stream): null tells the UI "no waveform", distinct from a decode error.
  if (samples.length === 0) return null
  const peaks = computePeaks(samples)
  // The renderer indexes the scan's arrays by peak bucket, so a mismatched length
  // (a sub-second clip decodes to fewer buckets than the fixed scan grid) drops
  // them instead of smearing marks across the wrong bars.
  const aligned = scan !== null && scan.clipped.length === peaks.length
  return {
    peaks,
    durationSec: samples.length / WAVEFORM_SAMPLE_RATE,
    clipped: aligned ? scan.clipped : undefined,
    // Lanes only make sense as an L/R pair: mono has nothing to split and surround
    // would need a different layout than two stacked lanes.
    channels: aligned && scan.channels.length === 2 ? scan.channels : undefined,
  }
}
