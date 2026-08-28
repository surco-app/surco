import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, constants as fsConstants, readFile, stat, unlink } from 'node:fs/promises'
import { constants as osConstants, setPriority, tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { promisify } from 'node:util'
import log from 'electron-log/main'
import { declickFilter } from '../shared/declick'
import { errorWithKey } from '../shared/errorKeys'
import { formatRatingTag } from '../shared/rating'
import { trimFilter } from '../shared/trim'
import type {
  BpmResult,
  ConversionQuality,
  CoverRead,
  DeclickMode,
  ForeignTag,
  KeyResult,
  LoudnessResult,
  MetaRead,
  Mp3Quality,
  NormalizeConfig,
  OutputFormat,
  TrackMetadata,
  TrackProperties,
  TrimRange,
  WaveformResult,
  WaveformScan,
} from '../shared/types'
import { cachedAnalysis } from './analysisCache'
import { isAbortError } from './analysisCancel'
import { ffmpegPath, ffprobePath } from './binaries'
import type { FullScan } from './channelScan'
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
import { declickRepairedArgs, parseDeclickedSamples, parseProgressSeconds } from './declick'
import { isPcmOverrun, slimDecodeError } from './decodeError'
import { measureBands } from './fftBands'
import {
  detectFftKnee,
  detectFlatShelf,
  BAND_START_HZ as SHELF_BAND_START_HZ,
  BAND_WIDTH_HZ as SHELF_BAND_WIDTH_HZ,
} from './hfShelf'
import { isMissingInputError } from './missingInput'
import { recordNmlPatch } from './nmlBatch'
import {
  astatsArgs,
  dcRemovalFilter,
  limitedLoudnormFilter,
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
import { renameWithRetry, rescuePath } from './renameRetry'
import { getSettings } from './settings'
import { createSharedScan } from './sharedScan'
import { MANAGED_ALIASES, TAG_FIELDS } from './tagFields'
import { readTagFormats } from './tagFormats'
import {
  type CueShift,
  keepsCuesInId3,
  preservesCuesInPlace,
  readCueTree,
  readItunesGrouping,
  readPopmRating,
  readWavId3Extras,
} from './tags'
import { TEMPO_SAMPLE_RATE } from './tempo'
import { tmpName } from './tmp'
import { WAVEFORM_BUCKETS, WAVEFORM_SAMPLE_RATE } from './waveform'
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
    // The file is simply not at that path any more — moved or renamed in Finder, or
    // replaced by a conversion. Stamped so the renderer can say so instead of showing
    // "could not analyse the audio", which blames the music for a stale path. Checked
    // before the repair below because there is nothing to repair: repairWav would open
    // every argument looking for a fixable WAV and find nothing.
    if (isMissingInputError(err)) throw errorWithKey('fileMissing', String(err))
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
}) as typeof execFileAsync &
  ((file: string, args: string[], opts?: RunOpts) => ReturnType<typeof execFileAsync>)

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

// Parses an `ffmpeg -f ffmetadata` dump into the foreign (unmanaged) tags: every KEY=VALUE
// pair whose name (lowercased) isn't in MANAGED_ALIASES, minus the encoder stamp. The bundled
// ffprobe (4.4.1) doesn't surface a WAV's ID3 TXXX frames, so reading foreign tags from the
// probe JSON missed them; the bundled ffmpeg does expose them, so readMeta reads them this
// way for every format (one code path, no per-container branch).
//
// ffmetadata format: `KEY=VALUE` per line; lines starting with `;` or `#` are comments; a
// value continues onto the next line when it ends with a backslash, and `=`, `;`, `#`, `\`
// and newlines inside a value are backslash-escaped. Only the FFMETADATA1 header line and
// the encoder stamp are dropped beyond the managed-alias filter.
export function foreignTagsFromFfmetadata(text: string): ForeignTag[] {
  const seen = new Set<string>()
  const foreign: ForeignTag[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith(';') || line.startsWith('#') || line.startsWith('FFMETADATA')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const name = unescapeFfmetadata(line.slice(0, eq))
    let rawValue = line.slice(eq + 1)
    // A trailing unescaped backslash continues the value onto the next line.
    while (rawValue.endsWith('\\') && !rawValue.endsWith('\\\\') && i + 1 < lines.length) {
      rawValue = `${rawValue.slice(0, -1)}\n${lines[++i]}`
    }
    const lower = name.toLowerCase()
    if (lower === 'encoder' || MANAGED_ALIASES.has(lower) || seen.has(lower)) continue
    seen.add(lower)
    foreign.push({ name, value: unescapeFfmetadata(rawValue) })
  }
  return foreign
}

// Undoes ffmetadata's backslash-escaping of the reserved characters, so a value or key
// reads back exactly as it was written.
function unescapeFfmetadata(text: string): string {
  return text.replace(/\\([=;#\\\n])/g, '$1')
}

// Reads the foreign tags through ffmpeg's ffmetadata muxer (see foreignTagsFromFfmetadata):
// `-i input -f ffmetadata -` writes the tags to stdout without decoding the audio, so it's
// as cheap as a probe. Best-effort — a failure yields no foreign tags rather than aborting
// the import, matching readMeta's degraded-on-failure contract.
export async function readForeignTags(input: string): Promise<ForeignTag[]> {
  try {
    const { stdout } = await run(
      ffmpegPath,
      ['-v', 'error', '-i', input, '-f', 'ffmetadata', '-'],
      { timeout: ANALYSIS_TIMEOUT_MS },
    )
    return foreignTagsFromFfmetadata(String(stdout))
  } catch {
    return []
  }
}

// The container's total duration in seconds, for the track row's time readout.
// Returns null rather than throwing on a missing/unparseable value, so a probe
// failure leaves the row without a time instead of aborting the whole file add
// (which runs this alongside readTags/readCover).
export async function probeDuration(input: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const { stdout } = await run(
      ffprobePath,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', input],
      { timeout: ANALYSIS_TIMEOUT_MS, signal },
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
  return withWavId3Extras(input, tagsFromProbe(JSON.parse(stdout)))
}

// A WAV carries a RIFF INFO chunk and an ID3 one at the same time, and ffmpeg's demuxer
// reads INFO and ignores ID3 — so every field INFO has no room for (label, grouping, key,
// BPM…) probes back empty even though it is on the file. Fills those from ID3, leaving
// whatever the probe already found untouched. A no-op for every other container, and for
// the fields INFO does carry. See readWavId3Extras for why the INFO chunk is kept at all.
function withWavId3Extras(input: string, tags: TrackMetadata): TrackMetadata {
  if (!WAV_INPUT.test(input)) return tags
  for (const [field, value] of Object.entries(readWavId3Extras(input))) {
    const key = field as keyof TrackMetadata
    if (value && !tags[key]?.trim()) tags[key] = value
  }
  return tags
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

// Display-thumbnail cap. The editor's artwork renders at w-40 (160 CSS px → 320 px on a
// 2× retina panel), so 384 keeps it crisp there with margin to spare while cutting the
// per-track base64 the whole crate holds in memory by ~44% vs the old 512 (384²/512²≈0.56)
// — the dominant memory scaler on a big crate. The lightbox loads the full-res original on
// demand, so it never depends on this thumbnail being large.
const COVER_THUMB_PX = 384

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
// extractCover calls spawned (each re-probing the same file). Cached on disk keyed by
// path+mtime (see cachedAnalysis): every session reopen re-read this same file uncached,
// so a big library paid 2-4 subprocess spawns per track on every launch. The cover
// thumbnail is a ~384px JPEG data URL (tens of KB), well under the cache's per-entry cap.
export async function readMeta(input: string): Promise<MetaRead> {
  const result = await cachedAnalysis('readmeta-v1', input, () => readMetaUncached(input))
  return result ?? { tags: {} as TrackMetadata, duration: null, cover: null, foreignTags: [] }
}

// The actual probe/decode work behind readMeta, split out so cachedAnalysis can tell a
// successful read (an object, cached) from a failed one (null, never pinned — retried on
// the next call rather than serving the degraded result forever).
async function readMetaUncached(input: string): Promise<MetaRead | null> {
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
    const tags = tagsFromProbe(data)
    // iTunes writes grouping to its own GRP1 frame, which ffprobe/ffmpeg don't surface — so a
    // file re-saved by Apple Music reads back with no grouping. When the probe found none,
    // fall back to reading GRP1 directly through TagLib (ID3 containers only; a no-op elsewhere).
    if (!tags.grouping.trim()) {
      const itunesGrouping = readItunesGrouping(input)
      if (itunesGrouping) tags.grouping = itunesGrouping
    }
    withWavId3Extras(input, tags)
    // Same gap for the star rating: ffprobe surfaces FLAC's Vorbis RATING comment but never
    // the ID3 POPM frame, so a track rated in Traktor read back unrated on MP3/AIFF and the
    // editor showed no stars at all. Fall back to reading POPM through TagLib when the probe
    // found no rating (ID3 containers only; a no-op elsewhere).
    if (!tags.rating?.trim()) {
      const popmRating = readPopmRating(input)
      if (popmRating) tags.rating = popmRating
    }
    return {
      tags,
      duration: Number.isFinite(seconds) ? seconds : null,
      cover: await extractCover(input, dims),
      // Read through ffmpeg, not the ffprobe JSON above: the bundled ffprobe (4.4.1) hides a
      // WAV's ID3 TXXX frames, so foreignTagsFromProbe(data) would miss them. readForeignTags
      // runs its own ffmpeg pass (best-effort) that surfaces them on every container.
      foreignTags: await readForeignTags(input),
    }
  } catch {
    // A probe failure leaves an editable row with no tags/duration/cover — the same
    // degraded state the three granular reads reached when each failed on its own.
    return null
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
  // Whether the samples reach the encoder as float regardless of the depth above. A lossy
  // decode maps to 16-bit integer, but its decoder still emits float, and a reduction from
  // a float chain needs dither — `float` alone stopped saying so once lossy stopped
  // meaning 24-bit, and the flag is read where the dither is decided.
  floatPipeline?: boolean
}

// float=true only for genuine float PCM sources (a field recorder's f32 WAV, a DAW
// bounce): their full precision IS the source's depth and must survive. A lossy
// decoder (mp3float/aac) also hands ffmpeg float samples, but that's an artifact of
// decoding, not source precision: an MP3 stores transform coefficients and has no bit
// depth to preserve at all. Those map to 16-bit — the precision a lossy decode really
// carries. Mapping them to 24 invented precision and tripled the file (a 320k MP3 became
// a 60KB FLAC where 16-bit gives 21KB, measured) for nothing audible, which is how
// "Same as source" came to bloat a converted collection. 16-bit is also integer PCM, so
// the reason float was ruled out (CDJs refuse float WAV) still holds.
function sourceDepth(probe: ProbeResult): SampleDepth {
  if (probe.codecName.startsWith('pcm_f')) return { float: true, bits: 32 }
  if (probe.sampleFmt.startsWith('f')) return { float: false, bits: 16, floatPipeline: true }
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
    // Extra spellings the same value is written under (Vorbis only): they must be excluded
    // from the clears below, or the alias sweep would erase what was just written.
    const also = vorbis ? (field.vorbisAlso ?? []) : []
    const written = new Set([name.toLowerCase(), ...also.map((n) => n.toLowerCase())])
    const clears = field.aliases
      .filter((alias) => !written.has(alias))
      .flatMap((alias) => ['-metadata', `${alias}=`])
    return [
      '-metadata',
      `${name}=${value}`,
      ...also.flatMap((extra) => ['-metadata', `${extra}=${value}`]),
      ...clears,
    ]
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
  clearExtras?: boolean,
  foreignRemoved?: string[],
  // Whether the user asked for the artwork to go. Without it a re-encode would carry
  // the source's picture across and quietly undo the removal.
  removeCover?: boolean,
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
  // No new cover and no removal asked for: carry the source's own picture across, or a
  // conversion whose only job was fixing a title would strip artwork the file already
  // had — "Surco deleted my cover" on an operation that never mentioned covers. The `?`
  // makes it optional, so a source with no picture is not an error. Same container
  // exclusions as embedCover: RIFF refuses a second stream, and M4A's art rides the
  // TagLib pass instead.
  else if (!removeCover && !WAV_INPUT.test(output) && !M4A_OUTPUT.test(output))
    args.push('-map', '0:v?', '-c:v', 'copy', '-disposition:v:0', 'attached_pic')
  // "Empty every metadata field" must reach frames the app never wrote. The default
  // -map_metadata 0 copies the source's global metadata into the re-encode, so a
  // foreign NOTES/COMMENT the app doesn't manage would ride through untouched (only
  // managed fields get an overriding empty tag). -1 copies nothing, leaving just the
  // explicit -metadata flags below. Traktor's cues are re-injected separately, so
  // dropping the carried metadata never costs the beatgrid.
  if (clearExtras) args.push('-map_metadata', '-1')

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
  }
  // El usuario marcó estos tags de terceros para borrar en el inspector: un -metadata
  // NOMBRE= vacío los elimina del fichero exportado. Se aplica siempre — es una intención
  // explícita sobre tags concretos, independiente del "borrar todo" (-map_metadata -1, que
  // ya se los lleva por delante cuando está activo, así que estos clears son redundantes
  // pero inofensivos en ese caso).
  for (const name of foreignRemoved ?? []) args.push('-metadata', `${name}=`)
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
      (normalize || src.float || src.floatPipeline || src.bits > 16 || rate !== undefined)
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
  // Centring the signal is a correction, not a property of how the gain is sized, so it
  // applies to whichever mode asked for it — a user fixing a biased vinyl capture and
  // normalizing to a loudness target wants both, and DC removal used to live only inside
  // peak mode, where picking loudness silently dropped it.
  //
  // It has to run BEFORE the level measurement: an offset capture reads a peak (and a
  // loudness) skewed by the bias, so centring afterwards would leave the track off its
  // target. Prepending it to `prefilter` puts it ahead of every measurement below, and
  // returning it as part of this function's filter puts it in the encode chain too.
  //
  // Peak mode's own combined filter already subtracts the mean while sizing each channel,
  // so it opts out here rather than centring twice — but only when peakRemoveDc is what
  // asked for it. peakPerChannel is a different axis (each channel to its own peak vs one
  // shared gain) and peakChannelFilter subtracts nothing for it, so opting out on that
  // left the bias untouched while the editor's readout promised an offset of 0%.
  const peakOwnsDc = cfg.mode === 'peak' && cfg.peakRemoveDc === true
  let dcAf: string | undefined
  if (cfg.removeDcOffset === true && !peakOwnsDc) {
    const channels = await cachedAnalysis(ns('astats-channels-v1'), input, async () => {
      const { stderr } = await run(ffmpegPath, astatsArgs(input, prefilter), {
        maxBuffer: 1024 * 1024 * 16,
      })
      return parseAstatsChannels(stderr)
    })
    dcAf = channels ? (dcRemovalFilter(channels) ?? undefined) : undefined
  }
  // Every measurement below reads through this, so the gains are sized on centred audio.
  const measurePrefilter = [prefilter, dcAf].filter(Boolean).join(',') || undefined
  // Puts the centring at the head of whatever this function returns, so the encode chain
  // carries it as well — null means "no filter", and DC alone is a valid filter.
  const withDc = (filter: string | null): string | null => {
    if (!dcAf) return filter
    return filter ? `${dcAf},${filter}` : dcAf
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
      // withDc like every other return here: peakChannelFilter only subtracts the mean
      // under peakRemoveDc, so a per-channel run that asked for centring gets it from
      // the shared stage — and when peak mode owns the removal, dcAf is unset and this
      // passes the filter through untouched rather than centring twice.
      return channels === null ? null : withDc(peakChannelFilter(cfg, channels))
    }
    // Peak mode is a constant-gain `volume` filter, which doesn't resample, so it
    // needs no rate restoration. The measured peak is a fact about the file and the
    // centring — it is measured through measurePrefilter, which carries dcAf — so the
    // key marks it like the loudnorm key below. One namespace for both served a peak
    // measured on the biased signal to a conversion that centres it, sizing the gain
    // against a maximum the audio no longer has.
    const max = await cachedAnalysis(ns(`volumedetect-v1${dcAf ? '-dc' : ''}`), input, async () => {
      const { stderr } = await run(ffmpegPath, volumedetectArgs(input, measurePrefilter), {
        maxBuffer: 1024 * 1024 * 16,
      })
      return parseMaxVolume(stderr)
    })
    return max === null ? null : withDc(volumeFilter(peakGainDb(cfg.peakDb, max)))
  }
  // The requested I/TP ride in the measurement filter and target_offset depends on
  // them, so the key carries both — same file, different target re-measures. The
  // fixed LRA is baked into the version suffix: bump it if LOUDNORM_LRA changes.
  const measured = await cachedAnalysis(
    ns(`loudnorm-measure-v1-I${cfg.targetLufs}-TP${cfg.truePeakDb}${dcAf ? '-dc' : ''}`),
    input,
    async () => {
      const { stderr } = await run(ffmpegPath, loudnormArgs(input, cfg, measurePrefilter), {
        maxBuffer: 1024 * 1024 * 16,
      })
      return parseLoudnorm(stderr)
    },
  )
  if (!measured) return null
  // A reachable target normalizes linearly (dynamics intact); a target too loud for a
  // constant gain (the club preset on most material) would otherwise land short, so
  // push the gain to target and limit the overs to the ceiling instead.
  return withDc(
    reachesTargetLinearly(cfg, measured)
      ? loudnormFilter(cfg, measured, sampleRate)
      : limitedLoudnormFilter(cfg, measured, sampleRate),
  )
}

// The cue re-anchoring a trim demands, in Traktor's millisecond units: positions
// move back by the head cut and clamp to the trimmed length when the tail was
// cut too. Undefined while no trim filter ran — the carried frames then stay
// byte-exact, as they always did for plain re-encodes and constant gains. The
// tempo rides along for the grid marker, whose phase can't be recomputed without
// it; a non-numeric or absent bpm tag simply leaves it undefined.
function cueShiftFor(
  trim: TrimRange | undefined,
  active: boolean,
  bpm: string,
): CueShift | undefined {
  if (!active || !trim) return undefined
  const startSec = trim.startSec ?? 0
  const tempo = Number(bpm)
  return {
    shiftMs: Math.round(startSec * 1000),
    maxMs: trim.endSec !== undefined ? Math.round((trim.endSec - startSec) * 1000) : undefined,
    bpm: Number.isFinite(tempo) && tempo > 0 ? tempo : undefined,
  }
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

// Traktor never stores a filesystem path: an ENTRY's LOCATION splits it into a
// VOLUME name, a DIR in Traktor's own "/:folder/:subfolder/:" syntax, and a bare
// FILE. Ground truth for this shape, checked against real collections:
// split_os_path() (macOS volume/Windows drive letter split) and friendly_to_dir()
// (the "/A/B/" -> "/:A/:B/:" folder encoding) in traktor_nml_cleaner.py. A path
// under neither /Volumes/ nor a Windows drive letter (e.g. the internal boot
// volume) keeps VOLUME as Traktor itself does: empty, with the whole path folded
// into DIR — split_os_path's fallback returns no volume for that case.
export function toNmlLocation(path: string): { volume: string; dir: string; file: string } {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const file = basename(normalized)
  const folderPath = dirname(normalized)
  const windowsDrive = folderPath.match(/^([A-Za-z]):(\/.*)?$/)
  const volumesMatch = folderPath.match(/^\/Volumes\/([^/]+)(\/.*)?$/)
  const [volume, folder] = windowsDrive
    ? [`${windowsDrive[1].toUpperCase()}:`, windowsDrive[2] || '/']
    : volumesMatch
      ? [volumesMatch[1], volumesMatch[2] || '/']
      : ['', folderPath || '/']
  // friendly_to_dir: force leading/trailing "/", then turn every "/" into "/:".
  const withSlashes = `${folder.startsWith('/') ? '' : '/'}${folder}${folder.endsWith('/') ? '' : '/'}`
  const dir = withSlashes.replace(/\//g, '/:')
  return { volume, dir, file }
}

// Best-effort and gated on a configured collection path so the feature costs
// nothing (no extra disk read, no accumulated patch) when it's off, which is the
// default. Reads the cue tree from the OUTPUT — the file as it now exists on disk
// — never the input, since a trim already re-anchored the cues there. VOLUME/DIR/
// FILE come from the INPUT path instead: that's the path Traktor has on file for
// this ENTRY, and newFile carries the rename separately. A failure here (unreadable
// tree, unparseable path) skips the record silently: the audio and its tags are
// already correct on disk, and this only feeds a later, separate NML write.
//
// newFile only gets set when the output stayed in the SAME directory as the
// input (overwriteOriginal / in-place edits, including a same-format rename):
// that's the one case where the ENTRY genuinely should follow the file, because
// the file it names still exists right there. The default path — output goes to
// the configured outputDir, a DIFFERENT directory (see inplace.ts) — builds
// volume/dir from the input, so a newFile there would repoint LOCATION at a
// FILE that shares the INPUT's folder but was actually written elsewhere: a
// path nothing lives at. Traktor would mark the track missing and the DJ loses
// its playlist membership and play count. Leaving newFile unset keeps the
// ENTRY pointed at the file Traktor still knows, cues updated in place — worse
// than a rename that actually lands, but strictly better than a dangling one.
function recordConversionPatch(
  input: string,
  output: string,
  meta: TrackMetadata,
  wroteArtwork: boolean,
): void {
  if (!getSettings().traktorNmlPath) return
  try {
    const { volume, dir, file } = toNmlLocation(input)
    const outputName = basename(output)
    const sameDir = dirname(input) === dirname(output)
    // meta.bpm is user-editable free text; empty or non-numeric must come out as
    // undefined; a NaN would pass around looking like a value and only fail
    // silently at cuesToXml's `> 0` check, dropping the beatgrid without a trace.
    const parsedBpm = Number(meta.bpm)
    const bpm = meta.bpm.trim() !== '' && Number.isFinite(parsedBpm) ? parsedBpm : undefined
    recordNmlPatch({
      volume,
      dir,
      file,
      newFile: sameDir && outputName !== file ? outputName : undefined,
      cueTree: readCueTree(output) ?? undefined,
      bpm,
      // Traktor caches artwork by COVERARTID and keeps serving it even after the
      // file on disk gets a new cover — the same stale-cache mechanism the cue
      // handling above exists to fix. wroteArtwork mirrors embedCover/finderCovers'
      // own signal (coverPath present, removeCover not set): only when a fresh
      // cover actually landed in the output is there anything for Traktor to re-read.
      clearCoverArt: wroteArtwork || undefined,
    })
  } catch {
    // Best-effort: see comment above.
  }
}

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
  // The "clear metadata" intent: wipe the rating along with every other field
  // (see writeTags). The cover already clears through removeCover.
  clearExtras?: boolean,
  // The specific third-party tags the inspector's user marked for deletion
  // (SERATO_MARKERS_V2, TRAKTOR4, …), independent of clearExtras. See writeTags.
  foreignRemoved?: string[],
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
      await runInWorker({
        type: 'writeTags',
        file: tmp,
        meta,
        coverPath,
        removeCover,
        clearExtras,
        foreignRemoved,
      })
    } else {
      const { stderr } = await run(
        ffmpegPath,
        convertArgs(
          input,
          tmp,
          plan,
          meta,
          coverPath,
          audioFilter,
          clearExtras,
          foreignRemoved,
          removeCover,
        ),
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
        //
        // cueSource rides this same save for the same reason the MP3/AIFF pass folds it
        // in: a WAV's cues live in the very "id3 " chunk this pass writes, and it is the
        // only pass a WAV target gets — the cue branches below are an else, so without
        // this a cued crate converted to WAV came out with no beatgrid at all. Passing
        // it on M4A is harmless: writeTags returns at the MP4 branch before the ID3
        // merge, since an ID3 tag forced into an MP4 would corrupt it.
        //
        // And the artwork has to be carried the same way. Every other target keeps the
        // source picture through convertArgs' `-map 0:v?`, but these two containers are
        // excluded from it (RIFF genuinely refuses a second stream — "WAVE files have
        // exactly one stream" — and M4A's art belongs in the covr atom), so this pass is
        // their only route. It only ever wrote a NEW cover, which left a conversion that
        // merely fixed a title stripping art the file already had: the same "Surco
        // deleted my cover" the `-map 0:v?` exists to prevent, still live on two formats.
        const carried = coverPath || removeCover ? null : await extractCoverFile(input)
        try {
          await runInWorker({
            type: 'writeTags',
            file: tmp,
            meta,
            coverPath: coverPath ?? carried ?? undefined,
            removeCover,
            clearExtras,
            foreignRemoved,
            cueSource: input,
            cueShift: cueShiftFor(trim, trimAf !== undefined, meta.bpm),
          })
        } finally {
          // Only the extracted copy is ours to delete; a caller-supplied coverPath is
          // owned by whoever passed it in.
          if (carried) await unlink(carried).catch(() => {})
        }
        // A WAV's cues live in an ID3 chunk, so a FLAC source hits the same wall the
        // MP3/AIFF targets did: cueSource clones ID3 frames and a Vorbis comment is not
        // one, leaving the WAV with no beatgrid at all. Re-armor it here, after the tag
        // pass that created the chunk. M4A is excluded on purpose — it has no ID3 to
        // write into, the same reason the ALAC path carries no cues.
        if (!clearExtras && ext === '.wav' && extname(input).toLowerCase() === '.flac')
          await runInWorker({
            type: 'copyCuesFromFlac',
            source: input,
            dest: tmp,
            shift: cueShiftFor(trim, trimAf !== undefined, meta.bpm),
          })
      } else if (
        (meta.rating?.trim() || meta.comment.trim() || clearExtras) &&
        (ext === '.mp3' || ext === '.aiff')
      ) {
        // ffmpeg can't emit a POPM frame, so a re-encoded MP3/AIFF needs a TagLib
        // pass to write the Traktor rating. Only done when there's something only this
        // pass can write (or a clear, which must actively wipe the POPM ffmpeg copied
        // over), to avoid a second tag pass on every conversion. cueSource folds the cue
        // carry-over (below) into this same save, so the rating never costs a second
        // whole-file rewrite on top of it.
        // A comment counts too: ffmpeg writes one as a TXXX described "comment", not the
        // COMM frame the spec defines and Traktor and mp3tag read, so an unrated track
        // reached them with no comment at all.
        await runInWorker({
          type: 'writeTags',
          file: tmp,
          meta,
          coverPath,
          clearExtras,
          foreignRemoved,
          cueSource: input,
          cueShift: cueShiftFor(trim, trimAf !== undefined, meta.bpm),
        })
        // cueSource only knows how to clone ID3 frames, so a FLAC source hands it nothing
        // and the rated file would keep ffmpeg's TXXX — the same loss the unrated path had,
        // reached through the other branch. Re-armor it here, after the rating is written:
        // the carry-over rewrites only the cue frames, leaving that POPM in place.
        if (!clearExtras && extname(input).toLowerCase() === '.flac')
          await runInWorker({
            type: 'copyCuesFromFlac',
            source: input,
            dest: tmp,
            shift: cueShiftFor(trim, trimAf !== undefined, meta.bpm),
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
      // Coming from a FLAC there are no ID3 frames to clone: the tree is armored in a
      // Vorbis comment, which ffmpeg re-emits as a TXXX text frame Traktor does not read.
      // That crossing needs the mirror of copyCuesToFlac — re-armor the comment into the
      // PRIV frame real Traktor files carry (see tags.ts).
      else if (preservesCuesInPlace(ext))
        await runInWorker(
          extname(input).toLowerCase() === '.flac'
            ? {
                type: 'copyCuesFromFlac',
                source: input,
                dest: tmp,
                shift: cueShiftFor(trim, trimAf !== undefined, meta.bpm),
              }
            : {
                type: 'copyCueFrames',
                source: input,
                dest: tmp,
                shift: cueShiftFor(trim, trimAf !== undefined, meta.bpm),
              },
        )
      // FLAC needs the mirror image: its armored TRAKTOR4 comment rides the
      // re-encode by itself, so nothing is carried over and only a trim matters
      // — the surviving comment is what ends up measuring from the wrong start.
      // Unless the source was ID3 (an AIFF crate moving to FLAC is the common
      // one): then no comment rode along, and the cues have to be re-armored out
      // of the source's PRIV frame instead.
      // A WAV source needs copyCuesToFlac just as much as an MP3/AIFF one: its cues also
      // live in an ID3 tag, which ffmpeg does not translate into a Vorbis comment. It is
      // excluded from preservesCuesInPlace for an unrelated reason (its ID3 rides inside a
      // RIFF chunk, so it takes the ffmpeg path rather than an in-place edit), and reusing
      // that predicate here silently routed it to shiftFlacCues — which had no comment to
      // re-anchor, so the cues were dropped. ID3_SOURCED names the real property this
      // branch needs: "the source keeps its cues in an ID3 tag".
      else if (ext === '.flac')
        await runInWorker(
          keepsCuesInId3(extname(input))
            ? {
                type: 'copyCuesToFlac',
                source: input,
                dest: tmp,
                shift: cueShiftFor(trim, trimAf !== undefined, meta.bpm),
              }
            : {
                type: 'shiftFlacCues',
                file: tmp,
                shift: cueShiftFor(trim, trimAf !== undefined, meta.bpm),
              },
        )
    }
    // Last touch before the rename so the header rides the same atomic landing.
    // Only when there's a cover to show — the header exists solely for Finder's
    // thumbnail, so a coverless (or cover-removed) FLAC stays fully standard.
    //
    // The art can come from either side: a cover being applied now (coverPath), or one
    // the file already carried. Requiring the former meant that merely fixing tags on a
    // FLAC that already had art left it without the header and blank in Finder — users
    // then ran their own tools to bolt it on, which is the chore this option exists to
    // remove. Extracted from `input`, not from the output: convertArgs maps only `0:a`,
    // so the encode never carries a picture across unless one is being applied. Returns
    // null on a file with no art, the same "nothing to show" case as before, which
    // leaves the FLAC standard.
    if (finderCovers && ext === '.flac' && !removeCover) {
      const headerCover = coverPath ?? (await extractCoverFile(input))
      if (headerCover) {
        await runInWorker({ type: 'prependFlacId3', file: tmp, meta, coverPath: headerCover })
        // Only the extracted copy is ours to delete; a caller-supplied coverPath is
        // owned by whoever passed it in.
        if (!coverPath) await unlink(headerCover).catch(() => {})
      }
    }
    // Logged because this failure only reproduces on Windows machines we cannot
    // attach a debugger to: when a user reports "another program is using the file",
    // these lines are the whole evidence — whether the destination was still held,
    // by how many attempts, and whether it ever freed.
    await renameWithRetry(tmp, output, {
      onRetry: ({ attempt, code, waitMs, path }) =>
        log.warn(
          `rename blocked: ${code} on ${path} (attempt ${attempt}${waitMs === null ? ', giving up' : `, retrying in ${waitMs}ms`})`,
        ),
      // The temp is a finished conversion by now — audio, tags and cues all written —
      // so a destination that never frees must not cost the user the whole job. When
      // the rescue lands, the error carries `rescuedTo` and the catch below leaves the
      // temp alone; when it cannot land (read-only remount, quota, a scanner holding
      // the whole directory), the temp is still where it was and the catch deletes it
      // as it would any half-written output.
      rescue: rescuePath,
    })
    // Comes after the rename, not before: the patch has to describe the file as
    // it now exists at `output`, and the cue-writing branches above (copyCueFrames,
    // copyCuesToFlac, shiftFlacCues) only ever touched `tmp`.
    recordConversionPatch(input, output, meta, !!(coverPath && !removeCover))
  } catch (e) {
    // A rescued temp is no longer at `tmp` — the rescue renamed it away — so the unlink
    // below finds nothing and the finished conversion survives on its own. Returning
    // early anyway makes that explicit rather than load-bearing on an ENOENT, and puts
    // the landing place in the log: without it a rescue leaves no trace anywhere, and
    // the user is told only that another program holds the file, with no hint that the
    // work is sitting right there under a sibling name.
    const rescuedTo = (e as { rescuedTo?: string })?.rescuedTo
    if (rescuedTo) {
      log.warn(`rename never landed; conversion kept at ${rescuedTo}`)
      throw e
    }
    // Whether the half-written temp is still on disk decides who owns it next. The
    // delete usually succeeds and the file is gone for good; when it doesn't — a
    // network volume still holding the handle is the case that bites — the path has to
    // stay in the manifest so the next launch sweeps it. Swallowing that failure left
    // the temp parked in the user's music folder with nothing recording its existence,
    // which reads as "a file that never finished converting".
    // ENOENT means the temp was never created (the encode died before writing) or is
    // already gone — nothing survived, so it must not be recorded as litter.
    const survived = await unlink(tmp).then(
      () => false,
      (err: NodeJS.ErrnoException) => err?.code !== 'ENOENT',
    )
    if (survived) {
      log.warn(`temp cleanup failed, left behind: ${tmp}`)
      Object.assign(e as object, { tmpSurvived: true })
    }
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

// Renders the whole track repaired, for the A/B against the original. null when the
// mode is off (nothing to preview) or the render was cancelled. The caller owns the
// output path (a quit-swept preview temp).
//
// Not timed out like the analysis reads: this is a full-length encode, and on a long
// side at the strong preset it can legitimately outrun ANALYSIS_TIMEOUT_MS — the same
// reason conversions run unbounded. What bounds it instead is the user: `onChild` hands
// the process out so a preset change (or a closed section) can kill it outright, which
// is also what makes the progress bar honest rather than a spinner nobody can escape.
export async function renderDeclickRepaired(
  input: string,
  output: string,
  mode: DeclickMode,
  onProgress?: (done: number) => void,
  onChild?: (child: { kill: (signal: string) => void }) => void,
): Promise<{ path: string } | null> {
  const args = declickRepairedArgs(input, output, mode)
  if (!args) return null
  const duration = await probeDuration(input)
  return await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args)
    // A cancel kills the child mid-write: that's the expected end of a cancelled render,
    // not a failure (hence the `killed` flag the close handler reads), and the
    // half-written temp is swept at quit like every other preview render.
    let killed = false
    onChild?.({
      kill: (signal: string) => {
        killed = true
        child.kill(signal as NodeJS.Signals)
      },
    })
    child.on('error', reject)
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk
      if (!onProgress || !duration) return
      const at = parseProgressSeconds(out)
      if (at !== null) onProgress(Math.min(1, at / duration))
    })
    child.on('close', (code) => {
      if (killed) return resolve(null)
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}`))
      onProgress?.(1)
      resolve({ path: output })
    })
  })
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

export async function generateSpectrogram(input: string, signal?: AbortSignal): Promise<string> {
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
      { timeout: ANALYSIS_TIMEOUT_MS, signal },
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

export interface BandSpec {
  freqHz: number
  widthHz: number
}

// Measures the energy in each high-frequency band by FFT over a sample of the
// track (see fftBands.ts) and hands the per-band levels to detectCutoff, which
// spots the codec's lowpass and the saw-tooth of reconstructed highs.
export async function analyzeCutoff(
  input: string,
  sampleRateHz: number,
  signal?: AbortSignal,
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
  // Duration only positions the probes; without it they all fall at the start,
  // which still measures the track, just less representatively.
  const durationSec = (await probeDuration(input, signal)) ?? 0
  const rms = await measureBands(input, specs, sampleRateHz, durationSec, signal)
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
export async function measureLoudness(
  input: string,
  signal?: AbortSignal,
): Promise<LoudnessResult | null> {
  // Two passes rather than one chained graph. ebur128's true-peak mode costs ~6× the
  // rest of the measurement (1.20s against 0.20s without it), and chaining astats
  // ahead of it makes the two run in sequence: 1.94s for the single graph where the
  // pair overlapping takes 1.28s, for byte-identical figures across the corpus.
  // Feeding both from one decode via asplit does not help (1.89s) — ffmpeg runs the
  // branches on the same thread, and the decode itself is only 0.05s of the total.
  const pass = (filter: string): Promise<{ stderr: string }> =>
    run(ffmpegPath, ['-hide_banner', '-nostats', '-i', input, '-af', filter, '-f', 'null', '-'], {
      maxBuffer: 1024 * 1024 * 16,
      timeout: ANALYSIS_TIMEOUT_MS,
      signal,
    })
  const [peakPass, statsPass] = await Promise.all([
    pass('ebur128=peak=true'),
    pass('astats=metadata=1:reset=0'),
  ])
  const loud = parseLoudness(peakPass.stderr)
  if (!loud) return null
  const stats = parseAstats(statsPass.stderr)
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
  opts: {
    sampleRate: number
    startSec?: number
    seconds?: number
    maxBufferMb: number
    signal?: AbortSignal
  },
): Promise<Float32Array> {
  const args = ['-hide_banner', '-loglevel', 'error']
  // Input seek (-ss before -i): ffmpeg jumps straight to the window instead of
  // decoding its way there — what keeps the zoomed re-decode interactive.
  if (opts.startSec !== undefined && opts.startSec > 0) args.push('-ss', String(opts.startSec))
  args.push('-i', input)
  if (opts.seconds !== undefined) args.push('-t', String(opts.seconds))
  // Cap the downmix matrix at unity gain. ffmpeg's mono downmix is power-preserving,
  // so two correlated channels come back ×√2 (+3.01 dB) — and every threshold
  // downstream reads this PCM as the file's own level. Most visibly the waveform's
  // clip marks: a track mastered to the -1 dBTP ceiling decoded to +2 dB and lit up
  // red end to end, reported as "Peaks over -1.0 dB". Unlike an explicit `pan`, this
  // leaves channel counts other than stereo to ffmpeg's own matrix.
  args.push('-ac', '1', '-rematrix_maxval', '1.0')
  args.push('-ar', String(opts.sampleRate), '-f', 'f32le', '-')
  let stdout: Buffer
  try {
    // A failed decode rejects with the child's whole stdout attached — tens of MB of
    // PCM. The handlers up the stack log these errors, and serializing that payload
    // froze the main process (see decodeError.ts); rethrow slim before it can spread.
    ;({ stdout } = await run(ffmpegPath, args, {
      encoding: 'buffer',
      maxBuffer: 1024 * 1024 * opts.maxBufferMb,
      timeout: ANALYSIS_TIMEOUT_MS,
      signal: opts.signal,
    }))
  } catch (err) {
    throw slimDecodeError(err)
  }
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
// A null means the decode overran its buffer ceiling: a corrupt file whose broken frames
// garble ffmpeg's `-t` accounting (a healthy 240 s window can't reach 16 MB at this rate).
// That failure is deterministic on every retry, so it surfaces as "unmeasurable" — the
// same cacheable null as beatless/atonal material — instead of throwing, which would
// re-decode tens of MB on every selection of the same broken track.
const inFlightAnalysisPcm = new Map<string, Promise<Float32Array | null>>()
function decodeAnalysisPcm(input: string): Promise<Float32Array | null> {
  const pending = inFlightAnalysisPcm.get(input)
  if (pending) return pending
  const decode = decodePcm(input, {
    sampleRate: TEMPO_SAMPLE_RATE,
    seconds: 240,
    maxBufferMb: 16,
  }).catch((err) => {
    if (isPcmOverrun(err)) return null
    throw err
  })
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
  if (pcm === null) return null
  return runInWorker<BpmResult | null>({ type: 'bpm', pcm, sampleRate: TEMPO_SAMPLE_RATE })
}

export async function measureKey(input: string): Promise<KeyResult | null> {
  const pcm = await decodeAnalysisPcm(input)
  if (pcm === null) return null
  return runInWorker<KeyResult | null>({ type: 'key', pcm, sampleRate: TEMPO_SAMPLE_RATE })
}

// Native 44.1 kHz mono PCM for the HF-shelf probe — unlike the tempo/key decoder's
// downsample, the shelf lives at 17-22 kHz, which a low analysis rate discards.
// Four minutes captures the shelf the whole-file average shows (a short window can
// miss it) while bounding the buffer: 44.1 kHz × 240 s mono ≈ 42 MB, hence 64 MB.
const SHELF_SAMPLE_RATE = 44100
function decodeShelfPcm(input: string, signal?: AbortSignal): Promise<Float32Array> {
  // 44.1 kHz × 240 s mono ≈ 42 MB, hence the 64 MB ceiling.
  return decodePcm(input, { sampleRate: SHELF_SAMPLE_RATE, seconds: 240, maxBufferMb: 64, signal })
}

// How far into a track the click detector reads. Eight minutes covers a typical vinyl
// side, and bounds the native-rate buffer at ~85 MB. Anything past it is unanalysed:
// the count says "estimate", but the marks drawn on the wave must not imply a clean
// tail they never looked at, so the renderer is told where the analysis stopped.
export const CLICK_SCAN_SECONDS = 480

// The editor's repair section: how many audible clicks the track carries and where they
// sit (see clickDetect.ts). Native rate, mono — a stylus click is 1-9 samples wide, so
// any downsample smears it away. Up to ~21M samples over an 8-minute side, so the O(n)
// second-difference scan ships to the worker (buffer transferred) like bpm/key/shelf —
// it fires while the user is auditioning the declick preview through surco://, and running
// it inline stalled that very stream.
export async function detectTrackClicks(
  input: string,
): Promise<{ count: number; marks: number[]; scannedSec: number }> {
  const pcm = await decodePcm(input, {
    sampleRate: SHELF_SAMPLE_RATE,
    seconds: CLICK_SCAN_SECONDS,
    maxBufferMb: 96,
  })
  const scannedSec = pcm.length / SHELF_SAMPLE_RATE
  const marks =
    (await runInWorker<number[]>({ type: 'clicks', pcm, sampleRate: SHELF_SAMPLE_RATE }, [
      pcm.buffer as ArrayBuffer,
    ])) ?? []
  return { count: marks.length, marks, scannedSec }
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
  signal?: AbortSignal,
): Promise<{ shelfCutoffHz: number | null; kneeCutoffHz: number | null }> {
  if (sampleRateHz !== SHELF_SAMPLE_RATE) return { shelfCutoffHz: null, kneeCutoffHz: null }
  const pcm = await decodeShelfPcm(input, signal)
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
// is the whole point of the panel, so a failure in the cutoff pass — which spawns
// its own decodes and so has more ways to go wrong than one ffmpeg call — must not
// discard a perfectly good image. We run both, but only a missing image rejects; a
// cutoff failure yields a null cutoff (so the UI hides the quality verdict rather
// than inventing one) and the real ffmpeg error is handed back for the caller to
// log instead of swallowing it.
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

// The persisted form of a spectrum build. The error fields are live-compute
// diagnostics for the caller to log once — never part of the cached result: 0.70.0
// cached a shelfError whose payload was the decode child's entire stdout (a 237 MB
// JSON entry), and every later open re-parsed and re-logged it, freezing the main
// process for seconds. The cutoff failure survives only as a flag, so the caller's
// shouldCache can still refuse to pin the partial verdict for the file's life.
export function cacheableSpectrum(
  built: SpectrumBuild,
): Omit<SpectrumBuild, 'cutoffError' | 'shelfError'> & { cutoffFailed: boolean } {
  const { cutoffError: _cutoff, shelfError: _shelf, ...rest } = built
  return { ...rest, cutoffFailed: built.cutoffError !== undefined }
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
): Promise<{ peaks: number[]; rms: number[] } | null> {
  const samples = await decodePcm(input, {
    sampleRate: WAVEFORM_SAMPLE_RATE,
    startSec,
    seconds: durSec,
    maxBufferMb: 32,
  })
  if (samples.length === 0) return null
  const wave = await runInWorker<{ peaks: number[]; rms: number[] }>(
    { type: 'waveformPeaks', pcm: samples, buckets },
    [samples.buffer as ArrayBuffer],
  )
  return wave ?? null
}

// The one native-rate, native-channel pass both waveform probes now read: true-clipping
// flags and each channel's envelope for the split L/R view, plus the mono envelope and
// frame count the strip draws. A resampled decode can give none of the first three —
// resampling smears the pinned flat tops and the mono downmix averages a one-channel rail
// away — which is how near-ceiling masters used to paint solid red while Audacity showed
// sparse marks. Streamed via spawn because a native stereo decode of a long mix is
// gigabytes of f32, far past any exec buffer, while the scan itself keeps only per-block
// accumulators.
// Probe the channel count and rate on the main process (cheap ffprobe), then hand the heavy
// spawn+stream reduction to the analysis worker so its ~32M-sample loop never blocks the
// event loop (IPC, menu, the surco:// audio stream). ffmpegPath rides along because the
// worker has no `app`/binaries to resolve it.
async function scanChannels(input: string): Promise<FullScan & { sampleRateHz: number }> {
  const { channels, sampleRate } = await probeAudio(input)
  const scan = (await runInWorker<FullScan>({
    type: 'channelScan',
    input,
    ffmpegPath,
    channels: Math.max(1, channels),
    timeoutMs: ANALYSIS_TIMEOUT_MS,
  })) as FullScan
  // ffprobe reports the rate as a string; 0 when it is missing or unparseable, which
  // measureWaveform reads as "no usable duration" rather than dividing into NaN.
  return { ...scan, sampleRateHz: Number(sampleRate) || 0 }
}

// Selecting a track fires audio:waveform and audio:waveform-scan together, and both used to
// decode the same file — the envelope at 4 kHz, the scan at native rate — so a play paid two
// full decodes of the same audio. They now share one, reference-counted so that the decode
// outlives every consumer but the last (see sharedScan.ts): the two probes abort
// independently, and honouring the first would strand the one still on screen.
const sharedScan = createSharedScan(scanChannels, (input: string) => {
  void runInWorker({ type: 'killChannelScan', input })
})

export async function measureWaveform(
  input: string,
  signal?: AbortSignal,
): Promise<WaveformResult | null> {
  // The envelope now rides the same native-rate pass as the clip/channel scan instead of
  // decoding the file a second time at 4 kHz. That resample was not cheap — it cost more
  // than the native decode it replaced (~120 ms of a 200 ms pass on a 7-minute FLAC) — and
  // it rounded transients off: measured across a track, the native pass reads a HIGHER peak
  // in 8191 of 8192 buckets, which is exactly the detail the max-abs reduction exists to keep.
  const scan = await sharedScan(input, signal)
  // Zero decoded frames means ffmpeg produced nothing (empty or undecodable stream): null
  // tells the UI "no waveform", distinct from a decode error.
  if (scan.frames === 0 || scan.sampleRateHz <= 0) return null
  // Duration from the decoded frame count, not the container's header, which can lie —
  // TrimSection maps its cut handles to seconds through this number.
  return {
    peaks: scan.mono.peaks,
    rms: scan.mono.rms,
    durationSec: scan.frames / scan.sampleRateHz,
  }
}

// The clip flags and split L/R lanes for the compare/player strip, off the shared native
// pass above. Best-effort — a failed scan resolves null and the strip just loses its marks,
// never its wave. Aligned to the fixed WAVEFORM_BUCKETS grid the peaks also use, so the
// renderer can index clip flags straight by peak bucket; a sub-second clip whose scan lands
// off-grid is dropped rather than smeared across the wrong bars.
export async function measureChannelScan(
  input: string,
  signal?: AbortSignal,
): Promise<WaveformScan | null> {
  // A genuine decode failure resolves null — the strip keeps its wave and just loses its
  // marks. An abort must NOT: it has to reach the handler as a throw, or cachedAnalysis
  // would pin "no marks" for the file's life because the user browsed past it mid-decode.
  const scan = await sharedScan(input, signal).catch((err: unknown) => {
    if (isAbortError(err)) throw err
    return null
  })
  if (scan === null || scan.clipped.length !== WAVEFORM_BUCKETS) return null
  return {
    clipped: scan.clipped,
    // Lanes only make sense as an L/R pair: mono has nothing to split and surround
    // would need a different layout than two stacked lanes.
    channels: scan.channels.length === 2 ? scan.channels : undefined,
  }
}
