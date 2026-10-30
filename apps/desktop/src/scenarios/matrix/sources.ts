import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { encodeBase91 } from '../../main/base91'
import { leadingId3v2Size } from '../../main/id3Header'
import { setFlacComment, writeTags } from '../../main/tags'
import {
  buildTraktorTree,
  id3WithPriv,
  injectAiffPriv,
  injectWavPriv,
  traktorCue,
} from '../../main/traktor4Fixture'
import { emptyMetadata } from '../../shared/metadata'
import { TAG_FIELDS } from '../../shared/tagFields'
import type { TrackMetadata } from '../../shared/types'
import { coverJpg } from '../fixtures'
import type { Origin } from './cells'

const FF = ffmpegStatic as unknown as string

export const MARKER_SEC = 10
const DURATION_SEC = 20
const CLICK_LEVEL = 0.8

export interface TrickyTags {
  title: string
  artist: string
  album: string
  genre: string
  grouping: string
  trackNumber: string
  discNumber: string
  bpm: string
  key: string
  publisher: string
  catalogNumber: string
  comment: string
}

export const TRICKY: TrickyTags = {
  title: 'Café Olé',
  artist: 'AC/DC',
  album: 'Back In Black',
  genre: 'House; Deep House',
  grouping: 'Peak Time',
  trackNumber: '3/12',
  discNumber: '1/2',
  bpm: '124',
  key: '8A',
  publisher: 'Surco Records',
  catalogNumber: 'SUR-001',
  comment: '🔥 promo',
}

export const SEEDED_CUES_MS: number[] = [MARKER_SEC * 1000, 15000]

export interface SourceTrack {
  origin: Origin
  path: string
  tags: TrickyTags
  coverSha1: string
  cuesMs: number[]
}

interface Encoding {
  ext: string
  rate: number
  args: string[]
}

const PCM16 = ['-c:a', 'pcm_s16le']
const AIFF16 = ['-c:a', 'pcm_s16be']
const MP3 = ['-c:a', 'libmp3lame', '-b:a', '320k', '-write_id3v2', '0']

const ENCODINGS: Record<Origin, Encoding> = {
  wav16: { ext: '.wav', rate: 44100, args: PCM16 },
  wav24: { ext: '.wav', rate: 96000, args: ['-c:a', 'pcm_s24le'] },
  aif: { ext: '.aif', rate: 44100, args: AIFF16 },
  aiff: { ext: '.aiff', rate: 44100, args: AIFF16 },
  flac: { ext: '.flac', rate: 44100, args: ['-c:a', 'flac', '-sample_fmt', 's16'] },
  alac: { ext: '.m4a', rate: 44100, args: ['-c:a', 'alac', '-sample_fmt', 's16p'] },
  aac: { ext: '.m4a', rate: 44100, args: ['-c:a', 'aac', '-b:a', '256k'] },
  mp3x: { ext: '.mp3', rate: 44100, args: [...MP3, '-write_xing', '1'] },
  mp3n: { ext: '.mp3', rate: 44100, args: [...MP3, '-write_xing', '0'] },
  mp3j: { ext: '.mp3', rate: 44100, args: [...MP3, '-write_xing', '0'] },
}

function signal(rate: number, leadSec: number): string {
  const kick = `0.95*sin(2*PI*55*(t-${leadSec}))*exp(-4*mod(t-${leadSec}\\,0.5))`
  const clickAt = Math.round((MARKER_SEC + leadSec) * rate)
  return `aevalsrc=if(lt(t\\,${leadSec})\\,0\\,${kick})+eq(n\\,${clickAt})*${CLICK_LEVEL}:s=${rate}:d=${DURATION_SEC + leadSec}`
}

function cueTree(): Uint8Array {
  return buildTraktorTree(
    SEEDED_CUES_MS.map((ms, i) => traktorCue(i === 0 ? 'Marker' : 'Drop', 0, ms, i)),
  )
}

function lyrics3Junk(): Buffer {
  const ett = 'ETT000010Some title'
  const block = `LYRICSBEGIN${ett}${String(ett.length).padStart(6, '0')}LYRICS200`
  return Buffer.concat([Buffer.from(block, 'latin1'), Buffer.alloc(512)])
}

function vorbisMetadataArgs(meta: TrackMetadata): string[] {
  return TAG_FIELDS.flatMap((field) => {
    const name = field.vorbis ?? field.id3
    const value = meta[field.key]?.trim()
    if (!name || !value) return []
    return [name, ...(field.vorbisAlso ?? [])].flatMap((n) => ['-metadata', `${n}=${value}`])
  })
}

function tagFlacLikeThePipeline(path: string, tags: TrickyTags, cover: string): void {
  const encoded = `${path}.encoded.flac`
  renameSync(path, encoded)
  const [trackNumber, trackTotal = ''] = tags.trackNumber.split('/')
  const [discNumber, discTotal = ''] = tags.discNumber.split('/')
  const meta = { ...emptyMetadata(), ...tags, trackNumber, trackTotal, discNumber, discTotal }
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-i',
    encoded,
    '-i',
    cover,
    '-map',
    '0:a',
    '-map',
    '1:v',
    '-c:v',
    'copy',
    '-disposition:v:0',
    'attached_pic',
    '-metadata:s:v:0',
    'comment=Cover (front)',
    '-c:a',
    'flac',
    '-sample_fmt',
    's16',
    '-fflags',
    '+bitexact',
    ...vorbisMetadataArgs(meta),
    path,
  ])
  rmSync(encoded)
  setFlacComment(path, meta.comment)
}

export function leadingTagsEnd(bytes: Buffer): number {
  let end = 0
  for (let size = leadingId3v2Size(bytes); size > 0; size = leadingId3v2Size(bytes.subarray(end))) {
    end += size
  }
  return end
}

export function makeSource(
  dir: string,
  origin: Origin,
  opts: { leadSilenceSec?: number; fileName?: string; tags?: Partial<TrickyTags> } = {},
): SourceTrack {
  const { ext, rate, args } = ENCODINGS[origin]
  const tags = { ...TRICKY, ...opts.tags }
  mkdirSync(dir, { recursive: true })
  const name = (opts.fileName ?? `${origin} Café Olé`).normalize('NFD')
  const path = join(dir, `${name}${ext}`)
  const tree = cueTree()
  const cues = origin === 'flac' ? ['-metadata', `TRAKTOR4=${encodeBase91(tree)}`] : []
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    signal(rate, opts.leadSilenceSec ?? 0),
    '-ac',
    '2',
    ...args,
    ...cues,
    path,
  ])
  if (origin === 'wav16' || origin === 'wav24') injectWavPriv(path, tree)
  else if (origin === 'aif' || origin === 'aiff') injectAiffPriv(path, tree)
  else if (ext === '.mp3')
    writeFileSync(path, Buffer.concat([id3WithPriv(tree), readFileSync(path)]))
  const cover = coverJpg(join(dir, `${name}.cover.jpg`))
  if (origin === 'flac') tagFlacLikeThePipeline(path, tags, cover)
  else writeTags(path, { ...emptyMetadata(), ...tags }, cover)
  if (origin === 'mp3j') {
    const bytes = readFileSync(path)
    const tagEnd = leadingTagsEnd(bytes)
    writeFileSync(
      path,
      Buffer.concat([bytes.subarray(0, tagEnd), lyrics3Junk(), bytes.subarray(tagEnd)]),
    )
  }
  const hasCues = origin !== 'alac' && origin !== 'aac'
  return {
    origin,
    path,
    tags,
    coverSha1: createHash('sha1').update(readFileSync(cover)).digest('hex'),
    cuesMs: hasCues ? SEEDED_CUES_MS : [],
  }
}
