import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { File as TagFile } from 'node-taglib-sharp'
import { errorKeyOf, errorWithKey } from '../shared/errorKeys'
import type { TrackMetadata } from '../shared/types'
import type { PlaceCheck, VerifyDetailKey } from '../shared/verification'
import {
  assertDecodable,
  type ConversionPlan,
  type DecodeProof,
  deliveredDurationSec,
  probeAudio,
} from './ffmpeg'
import { snapshotTags } from './tagSnapshot'
import { readEmbeddedCover } from './tags'
import { type PcmDigest, pcmDigest, pcmTimeoutMs } from './verifyPcm'

export interface FileExpect {
  path: string
  ext: ConversionPlan['ext']
  codec: string
  sampleRateHz?: number
  bitDepth?: number
  samplesKept: boolean
  sourcePcm?: PcmDigest
  sourceDurationSec?: number
  trimmedSec: number
  tags: Partial<TrackMetadata>
  cover: 'written' | 'removed' | 'untouched'
  proven?: DecodeProof
}

// signal is the job's cancel; timeoutMs bounds a decode by the file's size and length.
export interface ReadOpts {
  signal?: AbortSignal
  timeoutMs?: number
}

export interface FileReaders {
  exists(path: string): Promise<string | null>
  probe(path: string): ReturnType<typeof probeAudio>
  stat(path: string): Promise<Pick<DecodeProof, 'size' | 'mtimeMs' | 'ino'>>
  // The decoded length when the decode alone gave it, null when it came from another pass.
  assertDecodable(path: string, opts: ReadOpts): Promise<number | null>
  deliveredDurationSec(path: string, opts: ReadOpts): Promise<number | null>
  pcmDigest(path: string, opts: ReadOpts): Promise<PcmDigest>
  snapshotTags(path: string): string[] | Promise<string[]>
  readEmbeddedCover(path: string): Buffer | null
  m4aNumbers(path: string): { track: number; bpm: number }
}

async function findOnDisk(path: string): Promise<string | null> {
  const wanted = basename(path).normalize('NFC')
  const names = await readdir(dirname(path)).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return []
    throw e
  })
  const found = names.find((n) => n.normalize('NFC') === wanted)
  return found === undefined ? null : join(dirname(path), found)
}

export const fileReaders: FileReaders = {
  exists: findOnDisk,
  probe: probeAudio,
  stat,
  assertDecodable: (path, { signal, timeoutMs }) =>
    assertDecodable(path, undefined, { signal, timeout: timeoutMs }),
  deliveredDurationSec: (path, { signal, timeoutMs }) =>
    deliveredDurationSec(path, { signal, timeout: timeoutMs }),
  pcmDigest: (path, { signal }) => pcmDigest(path, { signal }),
  snapshotTags,
  readEmbeddedCover,
  m4aNumbers(path) {
    const f = TagFile.createFromPath(path)
    try {
      return { track: f.tag.track, bpm: f.tag.beatsPerMinute }
    } finally {
      f.dispose()
    }
  },
}

const FORMAT_BY_EXT: Record<string, string> = {
  '.wav': 'WAV',
  '.aiff': 'AIFF',
  '.aif': 'AIFF',
  '.mp3': 'MP3',
  '.flac': 'FLAC',
  '.m4a': 'M4A',
}

const PROBE_CODEC: Record<string, string> = { libmp3lame: 'mp3' }

const DURATION_TOLERANCE_SEC = 0.05
const DURATION_TOLERANCE_RATIO = 0.001
const LAST_FRAME_SAMPLES: Record<string, number> = {
  flac: 4608,
  alac: 4096,
  mp3: 1152,
  aac: 1024,
}

export const formatOf = (ext: string) =>
  FORMAT_BY_EXT[ext.toLowerCase()] ?? ext.replace('.', '').toUpperCase()

const check = (
  state: PlaceCheck['state'],
  key: VerifyDetailKey,
  params?: Record<string, string | number>,
): PlaceCheck => ({ place: 'file', state, detail: params ? { key, params } : { key } })

const TAG_LINES: Partial<Record<keyof TrackMetadata, RegExp>> = {
  title: /^(id3 TIT2|xiph TITLE|mp4 ©nam|riff INAM)=/,
  artist: /^(id3 TPE1|xiph ARTIST|mp4 ©ART|riff IART)=/,
  album: /^(id3 TALB|xiph ALBUM|mp4 ©alb)=/,
  albumArtist: /^(id3 TPE2|xiph ALBUMARTIST|mp4 aART)=/,
  genre: /^(id3 TCON|xiph GENRE|mp4 ©gen|riff IGNR)=/,
  year: /^(id3 (TDRC|TYER)|xiph (DATE|YEAR)|mp4 ©day|riff ICRD)=/,
  trackNumber: /^(id3 TRCK|xiph TRACKNUMBER|riff IPRT)=/,
  bpm: /^(id3 TBPM|xiph (TEMPO|BPM))=/,
  key: /^(id3 TKEY|xiph INITIALKEY|mp4 ----)=/,
  grouping: /^(id3 (TIT1|GRP1)|xiph GROUPING|mp4 ©grp)=/,
  comment: /^(id3 COMM\[[^\]]*\]|xiph (COMMENT|DESCRIPTION)|mp4 ©cmt|riff ICMT)=/,
}

const norm = (s: string) => s.normalize('NFC').trim()

function valueMatches(field: keyof TrackMetadata, expected: string, stored: string): boolean {
  const want = norm(expected)
  const have = norm(stored)
  if (field === 'trackNumber') return Number.parseInt(have, 10) === Number.parseInt(want, 10)
  if (field === 'bpm') return Number(have) === Number(want)
  if (field === 'year')
    return have.length >= 4 && want.length >= 4 && (have.startsWith(want) || want.startsWith(have))
  const values = have.split('|').map(norm)
  if (values.includes(want)) return true
  // ID3v2.3 has no separator of its own, so TagLib reads every '/' (and a TCON's ';') as
  // one: "AC/DC" comes back as AC and DC, in the order they were written.
  const parts = want.split(/[/;]/).map(norm)
  return parts.length === values.length && parts.every((p, i) => p === values[i])
}

function differingTag(
  lines: string[],
  tags: Partial<TrackMetadata>,
  m4a: { track: number; bpm: number } | null,
): keyof TrackMetadata | null {
  for (const field of Object.keys(TAG_LINES) as (keyof TrackMetadata)[]) {
    const expected = tags[field]
    if (typeof expected !== 'string') continue
    const want = norm(expected)
    if (m4a && (field === 'trackNumber' || field === 'bpm')) {
      const stored = field === 'trackNumber' ? m4a.track : m4a.bpm
      const meant = want === '' ? 0 : Math.round(Number.parseFloat(want))
      if (stored !== meant) return field
      continue
    }
    const pattern = TAG_LINES[field] as RegExp
    const stored = lines
      .filter((l) => pattern.test(l))
      .map((l) => l.slice(l.indexOf('=') + 1))
      .filter((v) => norm(v) !== '')
    if (want === '' ? stored.length > 0 : !stored.some((v) => valueMatches(field, want, v)))
      return field
  }
  return null
}

function bitsOf(probe: Awaited<ReturnType<typeof probeAudio>>): number {
  if (probe.bitsPerRawSample > 0) return probe.bitsPerRawSample
  const pcm = /^pcm_[suf](\d+)/.exec(probe.codecName)
  return pcm ? Number(pcm[1]) : 0
}

// A cancel is not a read that failed: it rejects with conversionCancelled, so the job ends
// as cancelled instead of reporting a file it never finished reading.
export async function checkFile(
  e: FileExpect,
  r: FileReaders,
  opts: { signal?: AbortSignal } = {},
): Promise<PlaceCheck> {
  try {
    return await judge(e, r, opts.signal)
  } catch {
    if (opts.signal?.aborted) throw errorWithKey('conversionCancelled')
    return check('unreadable', 'fileUnreadable')
  }
}

const isTruncation = (err: unknown) => {
  const key = errorKeyOf(err instanceof Error ? err.message : '')
  return key === 'convertedOutputTruncated' || key === 'convertedOutputUnreadable'
}

// The same bytes convertAudio proved decodable just before its rename, untouched since.
const sameAsProven = (proven: DecodeProof | undefined, now: Omit<DecodeProof, 'durationSec'>) =>
  proven !== undefined &&
  proven.size === now.size &&
  proven.mtimeMs === now.mtimeMs &&
  proven.ino === now.ino

async function judge(e: FileExpect, r: FileReaders, signal?: AbortSignal): Promise<PlaceCheck> {
  const found = await r.exists(e.path)
  if (found === null) return check('mismatch', 'fileMissing')

  const expectedFormat = formatOf(e.ext)
  const actualExt = extname(found).toLowerCase()
  if (actualExt !== e.ext)
    return check('mismatch', 'fileWrongFormat', {
      expected: expectedFormat,
      actual: formatOf(actualExt),
    })

  const probe = await r.probe(found)
  if (probe.codecName === '') return check('unreadable', 'fileUnreadable')
  const wantCodec = PROBE_CODEC[e.codec] ?? e.codec
  if (e.codec !== 'copy' && probe.codecName !== wantCodec)
    return check('mismatch', 'fileWrongFormat', {
      expected: `${expectedFormat} ${wantCodec}`,
      actual: `${expectedFormat} ${probe.codecName}`,
    })
  const rate = Number(probe.sampleRate)
  if (!Number.isFinite(rate) || rate <= 0) return check('unreadable', 'fileUnreadable')
  const bits = bitsOf(probe)
  if (e.bitDepth !== undefined && bits === 0) return check('unreadable', 'fileUnreadable')
  if (
    (e.sampleRateHz !== undefined && rate !== e.sampleRateHz) ||
    (e.bitDepth !== undefined && bits !== e.bitDepth)
  )
    return check('mismatch', 'fileWrongFormat', {
      expected: `${expectedFormat} ${e.sampleRateHz ?? rate} Hz ${e.bitDepth ?? bits} bits`,
      actual: `${expectedFormat} ${rate} Hz ${bits} bits`,
    })

  if (e.samplesKept && e.sourcePcm === undefined) return check('unreadable', 'fileUnreadable')
  if (!e.samplesKept && e.sourceDurationSec === undefined)
    return check('unreadable', 'fileUnreadable')

  const now = await r.stat(found)
  const opts = { signal, timeoutMs: pcmTimeoutMs(now.size, probe.headerSeconds) }
  // One decode at most: the digest when the samples were kept (equal to the source's, the
  // file decodes whole), else the decode that proves it whole also gives its length, and
  // the bytes convertAudio already proved need none at all.
  const decodes = async (): Promise<number | null | 'truncated'> => {
    try {
      return await r.assertDecodable(found, opts)
    } catch (err) {
      if (isTruncation(err)) return 'truncated'
      throw err
    }
  }
  const identical = e.samplesKept
  if (identical) {
    const out = await r.pcmDigest(found, opts)
    const src = e.sourcePcm as PcmDigest
    if (!out.md5 || !src.md5) return check('unreadable', 'fileUnreadable')
    if (out.md5 !== src.md5 || out.sampleRate !== src.sampleRate || out.channels !== src.channels)
      return check(
        'mismatch',
        (await decodes()) === 'truncated' ? 'fileTruncated' : 'filePcmDiffers',
      )
  } else {
    const proven = sameAsProven(e.proven, now) ? (e.proven as DecodeProof).durationSec : undefined
    const decoded = proven === undefined ? await decodes() : proven
    if (decoded === 'truncated') return check('mismatch', 'fileTruncated')
    const delivered = decoded ?? (await r.deliveredDurationSec(found, opts))
    if (delivered === null) return check('unreadable', 'fileUnreadable')
    const wanted = (e.sourceDurationSec as number) - e.trimmedSec
    if (!Number.isFinite(wanted) || !Number.isFinite(delivered))
      return check('unreadable', 'fileUnreadable')
    const tolerance = Math.max(DURATION_TOLERANCE_SEC, wanted * DURATION_TOLERANCE_RATIO)
    const lastFrame = (LAST_FRAME_SAMPLES[probe.codecName] ?? 0) / rate
    if (delivered < wanted - tolerance - lastFrame) return check('mismatch', 'fileTruncated')
    if (delivered > wanted + tolerance) return check('mismatch', 'filePcmDiffers')
  }

  const field = differingTag(
    await r.snapshotTags(found),
    e.tags,
    e.ext === '.m4a' ? r.m4aNumbers(found) : null,
  )
  if (field !== null) return check('mismatch', 'fileTagDiffers', { field })

  const cover = r.readEmbeddedCover(found)
  if (e.cover === 'written' && cover === null) return check('mismatch', 'fileNoCover')
  if (e.cover === 'removed' && cover !== null) return check('mismatch', 'fileCoverKept')

  return identical
    ? check('ok', 'fileIdentical', { format: expectedFormat })
    : check('ok', 'fileReencoded', { format: expectedFormat, rate, bits })
}
