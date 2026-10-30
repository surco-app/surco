import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import ffmpegStatic from 'ffmpeg-static'
import {
  Id3v2CommentsFrame,
  type Id3v2Frame,
  type Id3v2Tag,
  type Id3v2TextInformationFrame,
  Id3v2UnknownFrame,
  Id3v2UserTextInformationFrame,
  type Mpeg4AppleTag,
  Mpeg4BoxType,
  PictureType,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import type { OutputFormat } from '../../shared/types'
import type { Cell, InvariantName } from './cells'
import { type SourceTrack, TRICKY } from './sources'

const FF = ffmpegStatic as unknown as string
const PROBE = ffprobeInstaller.path

export interface Broken {
  invariant: InvariantName
  detail: string
}

interface Probe {
  container: string
  codec: string
  rate: number
  bits: number
  channels: number
  tags: Record<string, string>
}

function probe(path: string): Probe {
  const out = JSON.parse(
    execFileSync(PROBE, [
      '-v',
      'error',
      '-show_entries',
      'format=format_name:format_tags:stream=codec_type,codec_name,sample_rate,channels,bits_per_raw_sample,bits_per_sample',
      '-of',
      'json',
      path,
    ]).toString(),
  )
  const s = out.streams.find((x: { codec_type: string }) => x.codec_type === 'audio') ?? {}
  const tags: Record<string, string> = {}
  for (const [k, v] of Object.entries(out.format?.tags ?? {})) tags[k.toLowerCase()] = String(v)
  return {
    container: out.format?.format_name ?? '',
    codec: s.codec_name ?? '',
    rate: Number(s.sample_rate ?? 0),
    bits: Number(s.bits_per_raw_sample || s.bits_per_sample || 0),
    channels: Number(s.channels ?? 0),
    tags,
  }
}

function decode(path: string, args: string[]): Buffer {
  return execFileSync(FF, ['-v', 'error', '-i', path, '-map', '0:a:0', ...args, '-'], {
    maxBuffer: 1 << 29,
  })
}

export function pcmSha1(path: string): string {
  const { channels } = probe(path)
  return createHash('sha1')
    .update(decode(path, ['-ac', String(channels), '-f', 's32le']))
    .digest('hex')
}

function clickSec(path: string): number {
  const { rate } = probe(path)
  const pcm = decode(path, ['-ac', '1', '-f', 'f32le'])
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4))
  let best = 0
  let at = 0
  for (let i = 1; i < samples.length; i++) {
    const jump = Math.abs(samples[i] - samples[i - 1])
    if (jump > best) {
      best = jump
      at = i
    }
  }
  return at / rate
}

export function markerLagMs(source: string, output: string): number {
  return (clickSec(output) - clickSec(source)) * 1000
}

function durationSec(path: string, rate: number): number {
  return decode(path, ['-ac', '1', '-f', 's16le']).length / 2 / rate
}

function located(path: string): string | null {
  const dir = dirname(path)
  const want = basename(path).normalize('NFC')
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return null
  }
  const hit = names.find((name) => name.normalize('NFC') === want)
  return hit ? join(dir, hit) : null
}

const EXPECTED: Record<OutputFormat, { container: string; codec: RegExp; ext: string }> = {
  aiff: { container: 'aiff', codec: /^pcm_s\d+be$/, ext: '.aiff' },
  wav: { container: 'wav', codec: /^pcm_s\d+le$/, ext: '.wav' },
  flac: { container: 'flac', codec: /^flac$/, ext: '.flac' },
  alac: { container: 'mov,mp4,m4a,3gp,3g2,mj2', codec: /^alac$/, ext: '.m4a' },
  mp3: { container: 'mp3', codec: /^mp3$/, ext: '.mp3' },
}

const LOSSY = /^(mp3|aac)$/
const MP3_MAX_RATE = 48000
const TRIM_SEC = 2

function formatBroken(cell: Cell, src: Probe, path: string, out: Probe): string[] {
  const want = EXPECTED[cell.target]
  const keptAac = cell.target === 'alac' && src.codec === 'aac'
  const codec = keptAac ? /^aac$/ : want.codec
  const lossyOut = cell.target === 'mp3' || keptAac
  const rate =
    cell.quality === 'rate48'
      ? 48000
      : cell.target === 'mp3'
        ? Math.min(src.rate, MP3_MAX_RATE)
        : src.rate
  const bits = cell.quality === 'bits16' || LOSSY.test(src.codec) ? 16 : src.bits
  const broken: string[] = []
  if (out.container !== want.container)
    broken.push(`formato: contenedor '${out.container}', se esperaba '${want.container}'`)
  if (!codec.test(out.codec)) broken.push(`formato: códec '${out.codec}', se esperaba ${codec}`)
  if (extname(path).toLowerCase() !== want.ext)
    broken.push(`formato: extensión '${extname(path)}', se esperaba '${want.ext}'`)
  if (out.rate !== rate) broken.push(`formato: ${out.rate} Hz, se esperaba ${rate} Hz`)
  if (!lossyOut && out.bits !== bits) broken.push(`formato: ${out.bits} bits, se esperaba ${bits}`)
  return broken
}

const LOSSLESS_TARGET = new Set<OutputFormat>(['aiff', 'wav', 'flac', 'alac'])

function pcmBroken(
  cell: Cell,
  source: SourceTrack,
  src: Probe,
  path: string,
  out: Probe,
): string[] {
  const lossless = !LOSSY.test(src.codec) && !LOSSY.test(out.codec)
  if (lossless && LOSSLESS_TARGET.has(cell.target) && cell.quality === 'source') {
    return pcmSha1(path) === pcmSha1(source.path) ? [] : ['pcm: las muestras no son las del origen']
  }
  try {
    execFileSync(FF, ['-v', 'error', '-xerror', '-i', path, '-f', 'null', '-'])
  } catch {
    return ['pcm: no decodifica entero']
  }
  const frame = LOSSY.test(src.codec) || LOSSY.test(out.codec) ? 1152 : 2
  const want = durationSec(source.path, src.rate) - (cell.quality === 'trim' ? TRIM_SEC : 0)
  const got = durationSec(path, out.rate)
  return Math.abs(got - want) <= frame / Math.min(src.rate, out.rate)
    ? []
    : [`pcm: dura ${got.toFixed(4)} s, se esperaba ${want.toFixed(4)} s`]
}

const quoted = (values: string[]): string => values.map((v) => `'${v}'`).join(' + ')

function genresOf(values: string[]): string[] {
  return values
    .flatMap((v) => v.split(';'))
    .map((v) => v.trim())
    .filter(Boolean)
}

const WANT_GENRES = genresOf([TRICKY.genre])
const [WANT_TRACK, WANT_TRACK_TOTAL] = TRICKY.trackNumber.split('/')
const [WANT_DISC, WANT_DISC_TOTAL] = TRICKY.discNumber.split('/')

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function check(label: string, where: string, got: string[], want: string): string[] {
  if (got.length === 0) return [`${label}: ${where} ausente`]
  return sameList(got, [want]) ? [] : [`${label}: ${where} ${quoted(got)}, se esperaba '${want}'`]
}

function id3TextBytes(bytes: Uint8Array): string {
  const body = Buffer.from(bytes.subarray(1))
  const text =
    bytes[0] === 0
      ? body.toString('latin1')
      : bytes[0] === 3
        ? body.toString('utf8')
        : bytes[0] === 1
          ? body.subarray(2).toString('utf16le')
          : body.swap16().toString('utf16le')
  return text.replace(/\0+$/, '')
}

const SLASH_SPLIT = new Set(['TPE1'])

function id3Values(id3: Id3v2Tag, frame: Id3v2Frame): string[] {
  if (frame instanceof Id3v2UnknownFrame) return [id3TextBytes(frame.data.toByteArray())]
  const text = (frame as Id3v2TextInformationFrame).text ?? []
  return id3.version > 3 || !SLASH_SPLIT.has(frame.frameId.toString()) ? text : [text.join('/')]
}

function id3Frames(id3: Id3v2Tag, id: string): string[][] {
  return id3.frames.filter((f) => f.frameId.toString() === id).map((f) => id3Values(id3, f))
}

function id3Field(id3: Id3v2Tag, label: string, id: string, want: string): string[] {
  const frames = id3Frames(id3, id)
  if (frames.length > 1) return [`${label}: ${frames.length} frames ${id}`]
  return check(label, id, frames[0] ?? [], want)
}

function id3Broken(id3: Id3v2Tag | null, isWav: boolean): string[] {
  if (!id3) return ['tags: sin etiqueta ID3']
  const broken = [
    ...id3Field(id3, 'título', 'TIT2', TRICKY.title.normalize('NFC')),
    ...id3Field(id3, 'artista', 'TPE1', TRICKY.artist),
    ...id3Field(id3, 'álbum', 'TALB', TRICKY.album),
    ...id3Field(id3, 'pista', 'TRCK', TRICKY.trackNumber),
    ...id3Field(id3, 'disco', 'TPOS', TRICKY.discNumber),
    ...id3Field(id3, 'bpm', 'TBPM', TRICKY.bpm),
    ...id3Field(id3, 'tonalidad', 'TKEY', TRICKY.key),
    ...id3Field(id3, 'sello', 'TPUB', TRICKY.publisher),
  ]
  const genres = genresOf(id3Frames(id3, 'TCON').flat())
  if (!sameList(genres, WANT_GENRES))
    broken.push(`género: TCON ${quoted(genres)}, se esperaba '${TRICKY.genre}'`)
  const tit1 = id3Frames(id3, 'TIT1')[0] ?? []
  const grp1 = id3Frames(id3, 'GRP1')[0]
  const tit1Label = tit1.length ? `TIT1 ${quoted(tit1)}` : 'TIT1 ausente'
  if (!sameList(tit1, [TRICKY.grouping])) {
    broken.push(`grouping: ${tit1Label}, se esperaba '${TRICKY.grouping}'`)
  } else if (isWav && grp1) {
    broken.push(`grouping: GRP1 ${quoted(grp1)} en un WAV`)
  } else if (!isWav && !grp1) {
    broken.push(`grouping: ${tit1Label}, GRP1 ausente`)
  } else if (!isWav && grp1 && !sameList(grp1, [TRICKY.grouping])) {
    broken.push(`grouping: ${tit1Label}, GRP1 ${quoted(grp1)}`)
  }
  const catalog = id3.frames
    .filter((f): f is Id3v2UserTextInformationFrame => f instanceof Id3v2UserTextInformationFrame)
    .filter((f) => f.description.toUpperCase() === 'CATALOGNUMBER')
    .flatMap((f) => f.text)
  broken.push(...check('catálogo', 'TXXX CATALOGNUMBER', catalog, TRICKY.catalogNumber))
  const comments = id3.frames
    .filter((f): f is Id3v2CommentsFrame => f instanceof Id3v2CommentsFrame)
    .filter((f) => f.description === '')
    .map((f) => f.text)
  broken.push(...check('comentario', 'COMM', comments, TRICKY.comment))
  return broken
}

function xiphField(xiph: XiphComment, label: string, keys: string[], want: string): string[] {
  const present = keys.filter((k) => xiph.getField(k).length > 0)
  if (present.length === 0) return [`${label}: ${keys.join('/')} ausente`]
  return present.flatMap((k) => check(label, k, xiph.getField(k), want))
}

function xiphBroken(xiph: XiphComment | null): string[] {
  if (!xiph) return ['tags: sin comentario Vorbis']
  const genres = genresOf(xiph.getField('GENRE'))
  return [
    ...xiphField(xiph, 'título', ['TITLE'], TRICKY.title.normalize('NFC')),
    ...xiphField(xiph, 'artista', ['ARTIST'], TRICKY.artist),
    ...xiphField(xiph, 'álbum', ['ALBUM'], TRICKY.album),
    ...(sameList(genres, WANT_GENRES)
      ? []
      : [`género: GENRE ${quoted(genres)}, se esperaba '${TRICKY.genre}'`]),
    ...xiphField(xiph, 'grouping', ['GROUPING'], TRICKY.grouping),
    ...xiphField(xiph, 'pista', ['TRACKNUMBER'], WANT_TRACK),
    ...xiphField(xiph, 'pista', ['TRACKTOTAL'], WANT_TRACK_TOTAL),
    ...xiphField(xiph, 'disco', ['DISCNUMBER'], WANT_DISC),
    ...xiphField(xiph, 'disco', ['DISCTOTAL'], WANT_DISC_TOTAL),
    ...xiphField(xiph, 'bpm', ['BPM', 'TEMPO'], TRICKY.bpm),
    ...xiphField(xiph, 'tonalidad', ['INITIALKEY', 'KEY'], TRICKY.key),
    ...xiphField(xiph, 'sello', ['LABEL', 'PUBLISHER', 'ORGANIZATION'], TRICKY.publisher),
    ...xiphField(xiph, 'catálogo', ['CATALOGNUMBER'], TRICKY.catalogNumber),
    ...xiphField(xiph, 'comentario', ['COMMENT'], TRICKY.comment),
  ]
}

function pairOf(apple: Mpeg4AppleTag, box: typeof Mpeg4BoxType.TRKN): string[] {
  const data = apple.getQuickTimeData(box)[0]?.toByteArray()
  if (!data || data.length < 6) return []
  const view = Buffer.from(data)
  return [`${view.readUInt16BE(2)}/${view.readUInt16BE(4)}`]
}

function freeform(apple: Mpeg4AppleTag, name: string): string[] {
  return apple.getItunesStrings('com.apple.iTunes', name)
}

function appleBroken(apple: Mpeg4AppleTag | null): string[] {
  if (!apple) return ['tags: sin átomos de iTunes']
  const genres = genresOf(apple.getQuickTimeStrings(Mpeg4BoxType.GEN))
  const tmpo = apple.getQuickTimeData(Mpeg4BoxType.TMPO)[0]?.toByteArray()
  return [
    ...check(
      'título',
      '©nam',
      apple.getQuickTimeStrings(Mpeg4BoxType.NAM),
      TRICKY.title.normalize('NFC'),
    ),
    ...check('artista', '©ART', apple.getQuickTimeStrings(Mpeg4BoxType.ART), TRICKY.artist),
    ...check('álbum', '©alb', apple.getQuickTimeStrings(Mpeg4BoxType.ALB), TRICKY.album),
    ...(sameList(genres, WANT_GENRES)
      ? []
      : [`género: ©gen ${quoted(genres)}, se esperaba '${TRICKY.genre}'`]),
    ...check('grouping', '©grp', apple.getQuickTimeStrings(Mpeg4BoxType.GRP), TRICKY.grouping),
    ...check('pista', 'trkn', pairOf(apple, Mpeg4BoxType.TRKN), TRICKY.trackNumber),
    ...check('disco', 'disk', pairOf(apple, Mpeg4BoxType.DISK), TRICKY.discNumber),
    ...check('bpm', 'tmpo', tmpo ? [String(Buffer.from(tmpo).readUInt16BE(0))] : [], TRICKY.bpm),
    ...check('tonalidad', '----:initialkey', freeform(apple, 'initialkey'), TRICKY.key),
    ...check('sello', '----:publisher', freeform(apple, 'publisher'), TRICKY.publisher),
    ...check(
      'catálogo',
      '----:CATALOGNUMBER',
      freeform(apple, 'CATALOGNUMBER'),
      TRICKY.catalogNumber,
    ),
    ...check('comentario', '©cmt', apple.getQuickTimeStrings(Mpeg4BoxType.CMT), TRICKY.comment),
  ]
}

function probeTagsBroken(target: OutputFormat, tags: Record<string, string>): string[] {
  const want: [string, string][] = [
    ['title', TRICKY.title.normalize('NFC')],
    ['artist', TRICKY.artist],
  ]
  if (target === 'flac') {
    want.push(
      ['album', TRICKY.album],
      ['track', WANT_TRACK],
      ['tracktotal', WANT_TRACK_TOTAL],
      ['disc', WANT_DISC],
      ['disctotal', WANT_DISC_TOTAL],
    )
  } else if (target !== 'wav') {
    want.push(['album', TRICKY.album], ['track', TRICKY.trackNumber], ['disc', TRICKY.discNumber])
  }
  return want.flatMap(([key, value]) =>
    tags[key] === value ? [] : [`ffprobe: ${key} '${tags[key] ?? ''}', se esperaba '${value}'`],
  )
}

function withTagFile<T>(path: string, read: (f: TagFile) => T): T | string {
  let f: TagFile | undefined
  try {
    f = TagFile.createFromPath(path)
    return read(f)
  } catch (e) {
    return (e as Error).message
  } finally {
    f?.dispose()
  }
}

function tagsBroken(target: OutputFormat, path: string, out: Probe): string[] {
  const frames = withTagFile(path, (f) => {
    if (target === 'flac') return xiphBroken(f.getTag(TagTypes.Xiph, false) as XiphComment | null)
    if (target === 'alac')
      return appleBroken(f.getTag(TagTypes.Apple, false) as Mpeg4AppleTag | null)
    return id3Broken(f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null, target === 'wav')
  })
  const read = typeof frames === 'string' ? [`tags: TagLib no lo lee, ${frames}`] : frames
  return [...read, ...probeTagsBroken(target, out.tags)]
}

function coverBroken(path: string, expected: string | null): string[] {
  const image = withTagFile(path, (f) => {
    const pictures = f.tag.pictures
    const front = pictures.find((p) => p.type === PictureType.FrontCover) ?? pictures[0]
    return front ? createHash('sha1').update(front.data.toByteArray()).digest('hex') : null
  })
  if (expected === null) return image === null ? [] : ['carátula: presente y se esperaba quitada']
  if (image === null) return ['carátula: ausente']
  return image === expected ? [] : ['carátula: no es la que se preparó']
}

export function fileInvariants(
  cell: Cell,
  source: SourceTrack,
  finalPath: string,
  expectedCoverSha1: string | null,
): Broken[] {
  const path = located(finalPath)
  if (!path) return [{ invariant: 'format', detail: 'formato: el fichero final no existe' }]
  const src = probe(source.path)
  const out = probe(path)
  const as = (invariant: InvariantName) => (detail: string) => ({ invariant, detail })
  return [
    ...formatBroken(cell, src, path, out).map(as('format')),
    ...pcmBroken(cell, source, src, path, out).map(as('pcm')),
    ...tagsBroken(cell.target, path, out).map(as('tags')),
    ...coverBroken(path, expectedCoverSha1).map(as('cover')),
  ]
}
