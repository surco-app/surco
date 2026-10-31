import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import Database from 'better-sqlite3-multiple-ciphers'
import ffmpegStatic from 'ffmpeg-static'
import {
  Id3v2AttachmentFrame,
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
import {
  decodeBeatGrid,
  decodeQuickCues,
  decodeTrackData,
  inflateEngineBlob,
} from '../../main/engineBlobs'
import { analysedTrack } from '../../main/enginePerformanceFixture'
import { engineDbPath } from '../../main/enginePlaylistsFixture'
import { libraryBackupRoot } from '../../main/libraryBackups'
import { openRekordboxDb } from '../../main/rekordboxDb'
import { defaults } from '../../main/settings'
import { readTraktorCueStart, storedTree } from '../../main/traktor4Fixture'
import type { OutputFormat } from '../../shared/types'
import { music } from '../fakeMusic'
import type { Cell, InvariantName } from './cells'
import {
  analysisDataPathOf,
  bystanderRows,
  engineSeededCues,
  type LibrarySet,
  type Program,
  REKORDBOX_FILE_TYPE,
  SEEDED_ANALYSED,
  type SeededTrack,
  sha1Of,
  syncedPrograms,
  traktorEntryOf,
  twinIdOf,
} from './libraries'
import { SEEDED_CUES_MS, type SourceTrack, type TrickyTags } from './sources'

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
  let want = durationSec(source.path, src.rate)
  if (cell.quality === 'trim') {
    const cut = Math.max(0, -markerLagMs(source.path, path) / 1000)
    if (cut < 0.01 || cut > TRIM_SEC + frame / Math.min(src.rate, out.rate))
      return [`pcm: el recorte quitó ${cut.toFixed(2)} s, el silencio era de ${TRIM_SEC} s`]
    want -= cut
  }
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

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function check(label: string, where: string, got: string[], want: string | undefined): string[] {
  if (want === undefined) return []
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

function id3Broken(id3: Id3v2Tag | null, t: TrickyTags, isWav: boolean): string[] {
  if (!id3) return ['tags: sin etiqueta ID3']
  const broken = [
    ...id3Field(id3, 'título', 'TIT2', t.title.normalize('NFC')),
    ...id3Field(id3, 'artista', 'TPE1', t.artist),
    ...id3Field(id3, 'álbum', 'TALB', t.album),
    ...id3Field(id3, 'pista', 'TRCK', t.trackNumber),
    ...id3Field(id3, 'disco', 'TPOS', t.discNumber),
    ...id3Field(id3, 'bpm', 'TBPM', t.bpm),
    ...id3Field(id3, 'tonalidad', 'TKEY', t.key),
    ...id3Field(id3, 'sello', 'TPUB', t.publisher),
  ]
  const genres = genresOf(id3Frames(id3, 'TCON').flat())
  if (!sameList(genres, genresOf([t.genre])))
    broken.push(`género: TCON ${quoted(genres)}, se esperaba '${t.genre}'`)
  const tit1 = id3Frames(id3, 'TIT1')[0] ?? []
  const grp1 = id3Frames(id3, 'GRP1')[0]
  const tit1Label = tit1.length ? `TIT1 ${quoted(tit1)}` : 'TIT1 ausente'
  if (!sameList(tit1, [t.grouping]))
    broken.push(`grouping: ${tit1Label}, se esperaba '${t.grouping}'`)
  if (isWav && grp1) broken.push(`grouping: GRP1 ${quoted(grp1)} en un WAV`)
  if (!isWav && !grp1) broken.push(`grouping: ${tit1Label}, GRP1 ausente`)
  if (!isWav && grp1 && !sameList(grp1, [t.grouping]))
    broken.push(`grouping: GRP1 ${quoted(grp1)}, se esperaba '${t.grouping}'`)
  const catalog = id3.frames
    .filter((f): f is Id3v2UserTextInformationFrame => f instanceof Id3v2UserTextInformationFrame)
    .filter((f) => f.description.toUpperCase() === 'CATALOGNUMBER')
    .flatMap((f) => f.text)
  broken.push(...check('catálogo', 'TXXX CATALOGNUMBER', catalog, t.catalogNumber))
  const comments = id3.frames
    .filter((f): f is Id3v2CommentsFrame => f instanceof Id3v2CommentsFrame)
    .filter((f) => f.description === '')
    .map((f) => f.text)
  broken.push(...check('comentario', 'COMM', comments, t.comment))
  return broken
}

function xiphField(
  xiph: XiphComment,
  label: string,
  keys: string[],
  want: string | undefined,
): string[] {
  if (want === undefined) return []
  const present = keys.filter((k) => xiph.getField(k).length > 0)
  if (present.length === 0) return [`${label}: ${keys.join('/')} ausente`]
  return present.flatMap((k) => check(label, k, xiph.getField(k), want))
}

function xiphBroken(xiph: XiphComment | null, t: TrickyTags): string[] {
  if (!xiph) return ['tags: sin comentario Vorbis']
  const genres = genresOf(xiph.getField('GENRE'))
  const [track, trackTotal] = t.trackNumber.split('/')
  const [disc, discTotal] = t.discNumber.split('/')
  return [
    ...xiphField(xiph, 'título', ['TITLE'], t.title.normalize('NFC')),
    ...xiphField(xiph, 'artista', ['ARTIST'], t.artist),
    ...xiphField(xiph, 'álbum', ['ALBUM'], t.album),
    ...(sameList(genres, genresOf([t.genre]))
      ? []
      : [`género: GENRE ${quoted(genres)}, se esperaba '${t.genre}'`]),
    ...xiphField(xiph, 'grouping', ['GROUPING'], t.grouping),
    ...xiphField(xiph, 'pista', ['TRACKNUMBER'], track),
    ...xiphField(xiph, 'pista', ['TRACKTOTAL'], trackTotal),
    ...xiphField(xiph, 'disco', ['DISCNUMBER'], disc),
    ...xiphField(xiph, 'disco', ['DISCTOTAL'], discTotal),
    ...xiphField(xiph, 'bpm', ['BPM', 'TEMPO'], t.bpm),
    ...xiphField(xiph, 'tonalidad', ['INITIALKEY', 'KEY'], t.key),
    ...xiphField(xiph, 'sello', ['LABEL', 'PUBLISHER', 'ORGANIZATION'], t.publisher),
    ...xiphField(xiph, 'catálogo', ['CATALOGNUMBER'], t.catalogNumber),
    ...xiphField(xiph, 'comentario', ['COMMENT'], t.comment),
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

function appleBroken(apple: Mpeg4AppleTag | null, t: TrickyTags): string[] {
  if (!apple) return ['tags: sin átomos de iTunes']
  const genres = genresOf(apple.getQuickTimeStrings(Mpeg4BoxType.GEN))
  const tmpo = apple.getQuickTimeData(Mpeg4BoxType.TMPO)[0]?.toByteArray()
  return [
    ...check(
      'título',
      '©nam',
      apple.getQuickTimeStrings(Mpeg4BoxType.NAM),
      t.title.normalize('NFC'),
    ),
    ...check('artista', '©ART', apple.getQuickTimeStrings(Mpeg4BoxType.ART), t.artist),
    ...check('álbum', '©alb', apple.getQuickTimeStrings(Mpeg4BoxType.ALB), t.album),
    ...(sameList(genres, genresOf([t.genre]))
      ? []
      : [`género: ©gen ${quoted(genres)}, se esperaba '${t.genre}'`]),
    ...check('grouping', '©grp', apple.getQuickTimeStrings(Mpeg4BoxType.GRP), t.grouping),
    ...check('pista', 'trkn', pairOf(apple, Mpeg4BoxType.TRKN), t.trackNumber),
    ...check('disco', 'disk', pairOf(apple, Mpeg4BoxType.DISK), t.discNumber),
    ...check('bpm', 'tmpo', tmpo ? [String(Buffer.from(tmpo).readUInt16BE(0))] : [], t.bpm),
    ...check('tonalidad', '----:initialkey', freeform(apple, 'initialkey'), t.key),
    ...check('sello', '----:publisher', freeform(apple, 'publisher'), t.publisher),
    ...check('catálogo', '----:CATALOGNUMBER', freeform(apple, 'CATALOGNUMBER'), t.catalogNumber),
    ...check('comentario', '©cmt', apple.getQuickTimeStrings(Mpeg4BoxType.CMT), t.comment),
  ]
}

function probeTagsBroken(
  target: OutputFormat,
  t: TrickyTags,
  tags: Record<string, string>,
): string[] {
  const [track, trackTotal] = t.trackNumber.split('/')
  const [disc, discTotal] = t.discNumber.split('/')
  const want: [string, string | undefined][] = [
    ['title', t.title.normalize('NFC')],
    ['artist', t.artist],
  ]
  if (target === 'flac') {
    want.push(
      ['album', t.album],
      ['track', track],
      ['tracktotal', trackTotal],
      ['disc', disc],
      ['disctotal', discTotal],
    )
  } else if (target !== 'wav') {
    want.push(['album', t.album], ['track', t.trackNumber], ['disc', t.discNumber])
  }
  return want.flatMap(([key, value]) =>
    value === undefined || tags[key] === value
      ? []
      : [`ffprobe: ${key} '${tags[key] ?? ''}', se esperaba '${value}'`],
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

function paddedTrack(t: TrickyTags): TrickyTags {
  if (/[A-Za-z]/.test(t.trackNumber)) return t
  const pad = (v: string) => v.replace(/\D/g, '').padStart(2, '0')
  const [number, total] = t.trackNumber.split('/')
  return { ...t, trackNumber: total === undefined ? pad(number) : `${pad(number)}/${pad(total)}` }
}

function writtenTags(cell: Cell, t: TrickyTags): TrickyTags {
  const zeroPad = cell.settings?.zeroPadTrack ?? defaults.zeroPadTrack
  return zeroPad && cell.target !== 'alac' ? paddedTrack(t) : t
}

function tagsBroken(target: OutputFormat, t: TrickyTags, path: string, out: Probe): string[] {
  const frames = withTagFile(path, (f) => {
    if (target === 'flac')
      return xiphBroken(f.getTag(TagTypes.Xiph, false) as XiphComment | null, t)
    if (target === 'alac')
      return appleBroken(f.getTag(TagTypes.Apple, false) as Mpeg4AppleTag | null, t)
    return id3Broken(f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null, t, target === 'wav')
  })
  const read = typeof frames === 'string' ? [`tags: TagLib no lo lee, ${frames}`] : frames
  return [...read, ...probeTagsBroken(target, t, out.tags)]
}

interface Embedded {
  type: number
  data: Uint8Array
}

function leadingId3End(bytes: Buffer): number {
  let p = 0
  while (bytes.toString('latin1', p, p + 3) === 'ID3') {
    const size =
      ((bytes[p + 6] & 0x7f) << 21) |
      ((bytes[p + 7] & 0x7f) << 14) |
      ((bytes[p + 8] & 0x7f) << 7) |
      (bytes[p + 9] & 0x7f)
    p += 10 + size + (bytes[p + 5] & 0x10 ? 10 : 0)
  }
  return p
}

const FLAC_PICTURE = 6

function flacPictures(path: string): Embedded[] {
  const bytes = readFileSync(path)
  let p = leadingId3End(bytes)
  if (bytes.toString('latin1', p, p + 4) !== 'fLaC') return []
  p += 4
  const pictures: Embedded[] = []
  while (p + 4 <= bytes.length) {
    const head = bytes[p]
    const body = p + 4
    if ((head & 0x7f) === FLAC_PICTURE) {
      let q = body + 4
      q += 4 + bytes.readUInt32BE(q)
      q += 4 + bytes.readUInt32BE(q)
      q += 16
      const length = bytes.readUInt32BE(q)
      pictures.push({ type: bytes.readUInt32BE(body), data: bytes.subarray(q + 4, q + 4 + length) })
    }
    p = body + bytes.readUIntBE(p + 1, 3)
    if (head & 0x80) break
  }
  return pictures
}

function nativePictures(target: OutputFormat, path: string): Embedded[] | string {
  if (target === 'flac') return flacPictures(path)
  return withTagFile(path, (f) => {
    if (target === 'alac') {
      const apple = f.getTag(TagTypes.Apple, false) as Mpeg4AppleTag | null
      return (apple?.getQuickTimeData(Mpeg4BoxType.COVR) ?? []).map((d) => ({
        type: PictureType.FrontCover,
        data: d.toByteArray(),
      }))
    }
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    return (id3?.frames ?? [])
      .filter((fr): fr is Id3v2AttachmentFrame => fr instanceof Id3v2AttachmentFrame)
      .filter((fr) => fr.frameId.toString() === 'APIC')
      .map((fr) => ({ type: fr.type, data: fr.data.toByteArray() }))
  })
}

function coverBroken(target: OutputFormat, path: string, expected: string | null): string[] {
  const pictures = nativePictures(target, path)
  if (typeof pictures === 'string') return [`carátula: TagLib no lo lee, ${pictures}`]
  const front = pictures.find((p) => p.type === PictureType.FrontCover) ?? pictures[0]
  const image = front ? createHash('sha1').update(front.data).digest('hex') : null
  if (expected === null) return image === null ? [] : ['carátula: presente y se esperaba quitada']
  if (image === null) return ['carátula: ausente']
  return image === expected ? [] : ['carátula: no es la que se preparó']
}

function flacPrefixBroken(cell: Cell, path: string): string[] {
  if (cell.target !== 'flac' || cell.settings?.flacFinderCovers) return []
  const fd = openSync(path, 'r')
  const head = Buffer.alloc(3)
  try {
    readSync(fd, head, 0, 3, 0)
  } finally {
    closeSync(fd)
  }
  return head.toString('latin1') === 'ID3' ? ['formato: FLAC con ID3 delante'] : []
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
    ...flacPrefixBroken(cell, path).map(as('format')),
    ...pcmBroken(cell, source, src, path, out).map(as('pcm')),
    ...tagsBroken(cell.target, writtenTags(cell, source.tags), path, out).map(as('tags')),
    ...coverBroken(cell.target, path, expectedCoverSha1).map(as('cover')),
  ]
}

export interface Expected {
  finalPath: string
  at: Record<Program, string>
  lagMs: number
  rekordboxStartMovedMs: number
  traktorStartMovedMs: number
  samplesKept: boolean
  destGone: boolean
}

type Found = [InvariantName, string]

export const pointingAt = (path: string): Record<Program, string> => ({
  rekordbox: path,
  engine: path,
  traktor: path,
  music: path,
})

function canonical(path: string): string {
  try {
    return realpathSync(path).normalize('NFC')
  } catch {
    try {
      return join(realpathSync(dirname(path)), basename(path)).normalize('NFC')
    } catch {
      return path.normalize('NFC')
    }
  }
}

function sizeOf(path: string): number | null {
  try {
    return statSync(path).size
  } catch {
    return null
  }
}

function cuesAt(got: number[], want: number[]): boolean {
  const a = [...got].sort((x, y) => x - y)
  const b = [...want].sort((x, y) => x - y)
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 1)
}

const msList = (values: number[]): string => values.map((v) => v.toFixed(0)).join(', ')

const sameSet = <T>(a: T[], b: T[]): boolean =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i])

function rekordboxBroken(dbPath: string, t: SeededTrack, e: Expected): Found[] {
  const db = openRekordboxDb(dbPath, { readonly: true })
  if (!db) return [['points', 'rekordbox: la biblioteca no se puede abrir']]
  try {
    const final = canonical(e.at.rekordbox)
    const found: Found[] = []
    const row = db
      .prepare(
        `SELECT FolderPath, FileNameL, FileType, FileSize, AnalysisDataPath, Analysed
         FROM djmdContent WHERE ID = ? AND rb_local_deleted = 0`,
      )
      .get(t.rekordboxId) as
      | {
          FolderPath: string
          FileNameL: string
          FileType: number
          FileSize: number
          AnalysisDataPath: string | null
          Analysed: number | null
        }
      | undefined
    if (!row) found.push(['points', `rekordbox: la fila ${t.rekordboxId} ya no está`])
    else {
      if (canonical(row.FolderPath) !== final)
        found.push([
          'points',
          `rekordbox: FolderPath '${row.FolderPath}', se esperaba '${e.at.rekordbox}'`,
        ])
      if (row.FileNameL.normalize('NFC') !== basename(e.at.rekordbox).normalize('NFC'))
        found.push(['points', `rekordbox: FileNameL '${row.FileNameL}'`])
      const fileType = REKORDBOX_FILE_TYPE[extname(e.at.rekordbox).toLowerCase()]
      if (row.FileType !== fileType)
        found.push(['points', `rekordbox: FileType ${row.FileType}, se esperaba ${fileType}`])
      const size = sizeOf(e.at.rekordbox)
      if (size !== null && row.FileSize !== size)
        found.push(['points', `rekordbox: FileSize ${row.FileSize}, el fichero mide ${size}`])
      if (
        e.samplesKept &&
        (row.AnalysisDataPath !== analysisDataPathOf(t.rekordboxId) ||
          row.Analysed !== SEEDED_ANALYSED)
      )
        found.push(['cues', 'rekordbox: análisis borrado con las muestras conservadas'])
    }
    const live = db
      .prepare(`SELECT ID, FolderPath FROM djmdContent WHERE rb_local_deleted = 0`)
      .all() as { ID: string; FolderPath: string }[]
    const old = canonical(t.path)
    if (e.destGone && old !== final) {
      const stale = live.filter((r) => canonical(r.FolderPath) === old).length
      if (stale > 0) found.push(['points', `rekordbox: ${stale} filas vivas en la ruta vieja`])
    }
    const cues = (
      db
        .prepare(`SELECT InMsec FROM djmdCue WHERE ContentID = ? AND rb_local_deleted = 0`)
        .all(t.rekordboxId) as { InMsec: number }[]
    ).map((c) => c.InMsec)
    const moved = canonical(e.at.rekordbox) === canonical(e.finalPath) ? e.rekordboxStartMovedMs : 0
    const want = SEEDED_CUES_MS.map((ms) => ms + e.lagMs + moved)
    if (!cuesAt(cues, want))
      found.push(['cues', `rekordbox: cues en ${msList(cues)} ms, se esperaba ${msList(want)}`])
    const lists = (
      db
        .prepare(
          `SELECT PlaylistID FROM djmdSongPlaylist WHERE ContentID = ? AND coalesce(rb_local_deleted, 0) = 0`,
        )
        .all(t.rekordboxId) as {
        PlaylistID: string
      }[]
    ).map((r) => r.PlaylistID)
    if (!sameSet(lists, t.playlists.rekordbox))
      found.push(['playlists', `rekordbox: playlists ${lists.join(', ') || 'ninguna'}`])
    const atFinal = live.filter((r) => canonical(r.FolderPath) === final).length
    if (atFinal !== 1)
      found.push(['unique', `rekordbox: ${atFinal} filas vivas para el fichero final`])
    return found
  } finally {
    db.close()
  }
}

function rekordboxNewRows(dbPath: string, set: LibrarySet): Found[] {
  const db = openRekordboxDb(dbPath, { readonly: true })
  if (!db) return []
  try {
    const seeded = new Set(
      [...set.tracks, set.bystander].flatMap((t) => [t.rekordboxId, twinIdOf(t.rekordboxId)]),
    )
    const orphans = (
      db
        .prepare(
          `SELECT c.ID FROM djmdContent c WHERE c.rb_local_deleted = 0
           AND NOT EXISTS (SELECT 1 FROM djmdSongPlaylist s WHERE s.ContentID = c.ID
             AND coalesce(s.rb_local_deleted, 0) = 0)`,
        )
        .all() as { ID: string }[]
    ).filter((r) => !seeded.has(r.ID))
    return orphans.map((r): Found => ['unique', `rekordbox: fila nueva ${r.ID} sin playlists`])
  } finally {
    db.close()
  }
}

interface EnginePerf {
  trackData: Buffer | null
  beatData: Buffer | null
  quickCues: Buffer | null
  overviewWaveFormData: Buffer | null
}

function engineChain(entities: { id: number; trackId: number; nextEntityId: number }[]): number[] {
  const next = new Map(entities.map((x) => [x.id, x]))
  const pointed = new Set(entities.map((x) => x.nextEntityId))
  const order: number[] = []
  let at = entities.find((x) => !pointed.has(x.id))
  while (at && order.length < entities.length) {
    order.push(at.trackId)
    at = next.get(at.nextEntityId)
  }
  return order
}

function engineBroken(dir: string, set: LibrarySet, t: SeededTrack, e: Expected): Found[] {
  const db = new Database(engineDbPath(dir), { readonly: true, fileMustExist: true })
  try {
    const final = canonical(e.at.engine)
    const found: Found[] = []
    const row = db
      .prepare('SELECT path, fileType, fileBytes FROM Track WHERE id = ?')
      .get(t.engineId) as { path: string; fileType: string; fileBytes: number } | undefined
    if (!row) found.push(['points', `Engine: la pista ${t.engineId} ya no está`])
    else {
      if (canonical(resolve(dir, row.path)) !== final)
        found.push(['points', `Engine: path '${row.path}', se esperaba '${e.at.engine}'`])
      const fileType = extname(e.at.engine).slice(1).toLowerCase()
      if (row.fileType !== fileType)
        found.push(['points', `Engine: fileType '${row.fileType}', se esperaba '${fileType}'`])
      const size = sizeOf(e.at.engine)
      if (size !== null && row.fileBytes !== size)
        found.push(['points', `Engine: fileBytes ${row.fileBytes}, el fichero mide ${size}`])
    }
    const perf = db
      .prepare(
        'SELECT trackData, beatData, quickCues, overviewWaveFormData FROM PerformanceData WHERE trackId = ?',
      )
      .get(t.engineId) as EnginePerf | undefined
    const seeded = analysedTrack(t.engineId, engineSeededCues())
    if (!perf?.quickCues || !perf.trackData) found.push(['cues', 'Engine: sin análisis'])
    else if (e.samplesKept) {
      const changed = (
        ['trackData', 'beatData', 'quickCues', 'overviewWaveFormData'] as const
      ).filter((k) => !(perf[k] && seeded[k]?.equals(perf[k])))
      if (changed.length > 0)
        found.push(['cues', `Engine: ${changed.join(', ')} cambiado con las muestras conservadas`])
    } else {
      const rate = decodeTrackData(inflateEngineBlob(perf.trackData))?.sampleRate ?? 0
      const cues = (decodeQuickCues(inflateEngineBlob(perf.quickCues))?.slots ?? []).flatMap((s) =>
        s.cue ? [(s.cue.sample / rate) * 1000] : [],
      )
      const want = SEEDED_CUES_MS.map((ms) => ms + e.lagMs)
      if (!cuesAt(cues, want))
        found.push(['cues', `Engine: cues en ${msList(cues)} ms, se esperaba ${msList(want)}`])
      const grid = perf.beatData ? decodeBeatGrid(inflateEngineBlob(perf.beatData)) : null
      if (!grid?.markers.length) found.push(['cues', 'Engine: rejilla vacía'])
    }
    const entities = db
      .prepare('SELECT id, listId, trackId, nextEntityId FROM PlaylistEntity')
      .all() as { id: number; listId: number; trackId: number; nextEntityId: number }[]
    const lists = [
      ...new Set(entities.filter((x) => x.trackId === t.engineId).map((x) => x.listId)),
    ]
    if (!sameSet(lists, t.playlists.engine))
      found.push(['playlists', `Engine: playlists ${lists.join(', ') || 'ninguna'}`])
    const position = [...set.tracks, set.bystander].indexOf(t)
    for (const listId of t.playlists.engine) {
      const at = engineChain(entities.filter((x) => x.listId === listId)).indexOf(t.engineId)
      if (at !== -1 && at !== position)
        found.push([
          'playlists',
          `Engine: posición ${at + 1} en la playlist ${listId}, era ${position + 1}`,
        ])
    }
    const paths = db.prepare('SELECT path FROM Track').all() as { path: string }[]
    const atFinal = paths.filter((r) => canonical(resolve(dir, r.path)) === final).length
    if (atFinal !== 1) found.push(['unique', `Engine: ${atFinal} pistas para el fichero final`])
    return found
  } finally {
    db.close()
  }
}

const NML_ENTITIES: Record<string, string> = { quot: '"', lt: '<', gt: '>', amp: '&', apos: "'" }

function nmlAttr(tag: string, name: string): string | undefined {
  for (const m of tag.matchAll(/([A-Za-z_][\w.:-]*)="([^"]*)"/g))
    if (m[1] === name)
      return m[2].replace(/&([a-z]+);/g, (whole, ref: string) => NML_ENTITIES[ref] ?? whole)
  return undefined
}

function nmlPath(volume: string, dirAndFile: string): string {
  const path = dirAndFile.replace(/\/:/g, '/')
  return volume ? `/Volumes/${volume}${path}` : path
}

export function nmlLocationPath(location: string): string {
  return nmlPath(
    nmlAttr(location, 'VOLUME') ?? '',
    `${nmlAttr(location, 'DIR') ?? ''}${nmlAttr(location, 'FILE') ?? ''}`,
  )
}

export function nmlKeyPath(primaryKey: string): string {
  const value = nmlAttr(primaryKey, 'KEY') ?? ''
  const cut = value.indexOf('/:')
  return cut === -1 ? value : nmlPath(value.slice(0, cut), value.slice(cut))
}

interface NmlEntryRead {
  audioId?: string
  title?: string
  artist?: string
  path: string
  starts: number[]
}

function nmlCollection(nml: string): NmlEntryRead[] {
  const collection = nml.match(/<COLLECTION\b[\s\S]*?<\/COLLECTION>/)?.[0] ?? ''
  return [...collection.matchAll(/<ENTRY\b[^>]*>[\s\S]*?<\/ENTRY>/g)].map(([block]) => {
    const head = block.match(/<ENTRY\b[^>]*>/)?.[0] ?? ''
    const location = block.match(/<LOCATION\b[^>]*>/)?.[0] ?? ''
    return {
      audioId: nmlAttr(head, 'AUDIO_ID'),
      title: nmlAttr(head, 'TITLE'),
      artist: nmlAttr(head, 'ARTIST'),
      path: nmlLocationPath(location),
      starts: [...block.matchAll(/<CUE_V2\b[^>]*>/g)]
        .filter(([cue]) => nmlAttr(cue, 'TYPE') !== '4')
        .map(([cue]) => Number(nmlAttr(cue, 'START'))),
    }
  })
}

function nmlPlaylist(nml: string, uuid: string): string[] | null {
  const list = [...nml.matchAll(/<PLAYLIST\b[^>]*>[\s\S]*?<\/PLAYLIST>/g)].find(
    ([block]) => nmlAttr(block.match(/<PLAYLIST\b[^>]*>/)?.[0] ?? '', 'UUID') === uuid,
  )
  if (!list) return null
  return [...list[0].matchAll(/<PRIMARYKEY\b[^>]*>/g)].map(([key]) => nmlKeyPath(key))
}

export function traktorTimelineMs(path: string): number {
  if (extname(path).toLowerCase() !== '.mp3') return 0
  const out = JSON.parse(
    execFileSync(PROBE, [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-read_intervals',
      '%+#1',
      '-show_entries',
      'packet=pos,duration_time:stream=start_time',
      '-of',
      'json',
      path,
    ]).toString(),
  )
  const first = out.packets?.[0] ?? {}
  const bytes = readFileSync(path)
  let sync = leadingId3End(bytes)
  while (sync + 1 < bytes.length && !(bytes[sync] === 0xff && (bytes[sync + 1] & 0xe0) === 0xe0))
    sync++
  const headerFrame = sync < Number(first.pos) ? Number(first.duration_time) : 0
  return (Number(out.streams?.[0]?.start_time ?? 0) + headerFrame) * 1000
}

const MP3_FRAME_SAMPLES = 1152
const MP3_DECODER_DELAY = 529
const AAC_PRIMING_SAMPLES = 2112
const XING_FIELDS: [number, number][] = [
  [1, 4],
  [2, 4],
  [4, 100],
  [8, 4],
]

function mp3TimelineSamples(bytes: Buffer): number {
  let sync = leadingId3End(bytes)
  while (sync + 4 <= bytes.length && !(bytes[sync] === 0xff && (bytes[sync + 1] & 0xe0) === 0xe0))
    sync++
  const mono = bytes[sync + 3] >> 6 === 3
  const xing = sync + 4 + (mono ? 17 : 32)
  if (!['Info', 'Xing'].includes(bytes.toString('latin1', xing, xing + 4))) return 0
  const flags = bytes.readUInt32BE(xing + 4)
  let lame = xing + 8
  for (const [flag, size] of XING_FIELDS) if (flags & flag) lame += size
  if (bytes.toString('latin1', lame, lame + 4) !== 'LAME') return MP3_FRAME_SAMPLES
  const delay = (bytes[lame + 21] << 4) | (bytes[lame + 22] >> 4)
  return MP3_FRAME_SAMPLES + delay + MP3_DECODER_DELAY
}

const UNREAD_MOOV_RATE = 44100

function m4aTimelineMs(path: string): number {
  let out: {
    packets?: { pts_time?: string }[]
    streams?: { codec_name?: string; sample_rate?: string }[]
    format?: { tags?: Record<string, string> }
  }
  try {
    out = JSON.parse(
      execFileSync(
        PROBE,
        [
          '-v',
          'error',
          '-select_streams',
          'a:0',
          '-read_intervals',
          '%+#1',
          '-show_entries',
          'packet=pts_time:stream=codec_name,sample_rate:format_tags',
          '-of',
          'json',
          path,
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      ).toString(),
    )
  } catch {
    return (AAC_PRIMING_SAMPLES / UNREAD_MOOV_RATE) * 1000
  }
  const stream = out.streams?.[0]
  if (stream?.codec_name !== 'aac') return 0
  const edited = -Number(out.packets?.[0]?.pts_time ?? 0)
  if (edited > 0) return edited * 1000
  const smpb = Object.entries(out.format?.tags ?? {}).find(([k]) => k.toLowerCase() === 'itunsmpb')
  const declared = smpb ? Number.parseInt(smpb[1].trim().split(/\s+/)[1] ?? '0', 16) : 0
  return declared > 0 ? (declared / Number(stream.sample_rate)) * 1000 : 0
}

export function rekordboxTimelineMs(path: string): number {
  const ext = extname(path).toLowerCase()
  if (ext === '.m4a') return m4aTimelineMs(path)
  const samples = ext === '.mp3' ? mp3TimelineSamples(readFileSync(path)) : 0
  return samples === 0 ? 0 : (samples / probe(path).rate) * 1000
}

function traktorBroken(nmlFile: string, set: LibrarySet, t: SeededTrack, e: Expected): Found[] {
  const nml = readFileSync(nmlFile, 'utf8')
  const final = canonical(e.at.traktor)
  const stays = final !== canonical(e.finalPath)
  const entries = nmlCollection(nml)
  const found: Found[] = []
  const byId = entries.filter((x) => x.audioId === t.traktorAudioId)
  const byTags = entries.filter(
    (x) => x.title === t.tags.title.normalize('NFC') && x.artist === t.tags.artist,
  )
  const candidates = byId.length > 0 ? byId : byTags
  const entry = candidates.length === 1 ? candidates[0] : undefined
  const shift = e.lagMs + e.traktorStartMovedMs
  const want = SEEDED_CUES_MS.map((ms) => ms + shift)
  if (candidates.length > 1)
    found.push(['points', `Traktor: ${candidates.length} entradas posibles para la pista`])
  else if (!entry) found.push(['points', 'Traktor: la entrada ya no está'])
  else {
    if (canonical(entry.path) !== final)
      found.push(['points', `Traktor: LOCATION '${entry.path}', se esperaba '${e.at.traktor}'`])
    if (stays) found.push(...stayedEntryBroken(nml, set, t))
    else if (!cuesAt(entry.starts, want))
      found.push([
        'cues',
        `Traktor: CUE_V2 en ${msList(entry.starts)} ms, se esperaba ${msList(want)}`,
      ])
  }
  if (t.cuesMs.length > 0 && extname(e.finalPath).toLowerCase() !== '.m4a') {
    const path = located(e.finalPath)
    const tree = path ? storedTree(path) : null
    const wantFile = t.cuesMs.map((ms) => ms + shift)
    if (!tree) found.push(['cues', 'Traktor: el fichero no lleva TRAKTOR4'])
    else {
      const starts = t.cuesMs.map((_, i) => readTraktorCueStart(tree, i))
      if (!cuesAt(starts, wantFile))
        found.push([
          'cues',
          `Traktor: TRAKTOR4 en ${msList(starts)} ms, se esperaba ${msList(wantFile)}`,
        ])
    }
  }
  const known = new Set(entries.map((x) => canonical(x.path)))
  for (const uuid of t.playlists.traktor) {
    const keys = (nmlPlaylist(nml, uuid) ?? []).map(canonical)
    if (!keys.includes(final))
      found.push(['playlists', `Traktor: la playlist ${uuid} ya no nombra la pista`])
    if (keys.some((k) => !known.has(k)))
      found.push(['playlists', `Traktor: la playlist ${uuid} nombra una ubicación sin entrada`])
  }
  const atFinal = entries.filter((x) => canonical(x.path) === final).length
  if (atFinal !== 1) found.push(['unique', `Traktor: ${atFinal} entradas para el fichero final`])
  const atConverted = entries.filter((x) => canonical(x.path) === canonical(e.finalPath)).length
  if (stays && atConverted > 0)
    found.push(['unique', `Traktor: ${atConverted} entradas para el fichero convertido`])
  return found
}

const cueTags = (entry: string): string => [...entry.matchAll(/<CUE_V2\b[^>]*>/g)].join('\n')
const rankingOf = (entry: string): string | undefined =>
  nmlAttr(entry.match(/<ENTRY\b[^>]*>/)?.[0] ?? '', 'RANKING') ??
  nmlAttr(entry.match(/<INFO\b[^>]*>/)?.[0] ?? '', 'RANKING')

function stayedEntryBroken(nml: string, set: LibrarySet, t: SeededTrack): Found[] {
  const seeded = set.traktorEntries[t.traktorAudioId] ?? ''
  const now = traktorEntryOf(nml, t.traktorAudioId)
  const found: Found[] = []
  if (cueTags(now) !== cueTags(seeded))
    found.push(['cues', 'Traktor: la entrada del original cambió sus CUE_V2'])
  if (rankingOf(now) !== rankingOf(seeded))
    found.push(['collateral', 'Traktor: la entrada del original cambió su RANKING'])
  return found
}

const MUSIC_TAGS: [string, 'title' | 'artist' | 'album' | 'grouping'][] = [
  ['título', 'title'],
  ['artista', 'artist'],
  ['álbum', 'album'],
  ['grouping', 'grouping'],
]

function musicBroken(t: SeededTrack, e: Expected): Found[] {
  const final = canonical(e.at.music)
  const living = music.state.entries.filter(
    (x) => x.location !== null && canonical(x.location) === final,
  )
  const found: Found[] = []
  if (living.length === 0)
    found.push(['points', 'Music: ninguna entrada reproduce el fichero final'])
  const old = t.musicPid ? music.entry(t.musicPid) : undefined
  if (old && (old.location === null || canonical(old.location) !== final))
    found.push(['points', 'Music: la entrada vieja sigue viva'])
  for (const entry of living)
    for (const [label, field] of MUSIC_TAGS)
      if (entry[field].normalize('NFC') !== t.tags[field].normalize('NFC'))
        found.push(['tags', `Music: ${label} '${entry[field]}', se esperaba '${t.tags[field]}'`])
  for (const pid of t.playlists.music) {
    const list = music.playlist(pid)
    if (!living.some((x) => list?.entries.includes(x.persistentId)))
      found.push(['playlists', `Music: la playlist ${list?.name ?? pid} ya no la tiene`])
  }
  if (living.length > 1)
    found.push(['unique', `Music: ${living.length} entradas para el fichero final`])
  return found
}

function musicNewEntries(set: LibrarySet): Found[] {
  const seeded = new Set([...set.tracks, set.bystander].map((t) => t.musicPid))
  return music.state.entries
    .filter((x) => !seeded.has(x.persistentId))
    .filter((x) => x.location === null || !existsSync(x.location))
    .map((x): Found => ['unique', `Music: entrada nueva ${x.persistentId} sin fichero`])
}

function programBroken(program: Program, set: LibrarySet, t: SeededTrack, e: Expected): Found[] {
  if (program === 'rekordbox') return set.rekordboxDb ? rekordboxBroken(set.rekordboxDb, t, e) : []
  if (program === 'engine') return set.engineDir ? engineBroken(set.engineDir, set, t, e) : []
  if (program === 'traktor') return set.traktorNml ? traktorBroken(set.traktorNml, set, t, e) : []
  return set.music ? musicBroken(t, e) : []
}

const PROGRAM_NAME: Record<'rekordbox' | 'engine' | 'traktor', string> = {
  rekordbox: 'rekordbox',
  engine: 'Engine',
  traktor: 'Traktor',
}

function libraryFile(
  set: LibrarySet,
  program: 'rekordbox' | 'engine' | 'traktor',
): string | undefined {
  if (program === 'rekordbox') return set.rekordboxDb
  if (program === 'engine') return set.engineDir && engineDbPath(set.engineDir)
  return set.traktorNml
}

function backedUp(path: string, sha1: string): boolean {
  let root: string
  try {
    root = libraryBackupRoot()
  } catch {
    return false
  }
  const below = (dir: string): string[] => {
    try {
      return readdirSync(dir).map((name) => join(dir, name))
    } catch {
      return []
    }
  }
  return below(root)
    .flatMap((collection) => below(join(collection, 'history')))
    .map((copy) => join(copy, basename(path)))
    .some((file) => existsSync(file) && sha1Of(file) === sha1)
}

function bystanderRowsBroken(set: LibrarySet): Found[] {
  const now = bystanderRows(set, set.bystander)
  return (['rekordbox', 'engine', 'traktor'] as const)
    .filter((p) => set.bystanderRows[p] !== undefined && now[p] !== set.bystanderRows[p])
    .map((p): Found => ['collateral', `otra pista, ${PROGRAM_NAME[p]}: sus filas cambiaron`])
}

function collateralBroken(cell: Cell, set: LibrarySet): Found[] {
  const synced = new Set<Program>(syncedPrograms(cell.programs))
  return (['rekordbox', 'engine', 'traktor'] as const).flatMap((program): Found[] => {
    const file = libraryFile(set, program)
    const before = set.sha1Before[program]
    if (!file || before === null || sha1Of(file) === before) return []
    if (!synced.has(program))
      return [['collateral', `${PROGRAM_NAME[program]}: la biblioteca no sincronizada cambió`]]
    return backedUp(file, before)
      ? []
      : [['collateral', `${PROGRAM_NAME[program]}: escrita sin copia de seguridad previa`]]
  })
}

function diskBroken(t: SeededTrack, e: Expected): Found[] {
  const found: Found[] = []
  let names: string[] = []
  try {
    names = readdirSync(dirname(e.finalPath))
  } catch {}
  for (const name of names.filter((n) => n.includes('.tmp-')))
    found.push(['unique', `disco: queda el temporal ${name}`])
  if (!e.destGone && !located(t.path)) found.push(['unique', 'disco: el original ya no está'])
  return found
}

export function libraryInvariants(
  cell: Cell,
  set: LibrarySet,
  track: SeededTrack,
  expected: Expected,
): Broken[] {
  const programs = syncedPrograms(cell.programs)
  const other = set.bystander
  const untouched: Expected = {
    finalPath: other.path,
    at: pointingAt(other.path),
    lagMs: 0,
    rekordboxStartMovedMs: 0,
    traktorStartMovedMs: 0,
    samplesKept: true,
    destGone: false,
  }
  const found: Found[] = [
    ...programs.flatMap((p) => programBroken(p, set, track, expected)),
    ...(programs.includes('rekordbox') && set.rekordboxDb
      ? rekordboxNewRows(set.rekordboxDb, set)
      : []),
    ...(set.music ? musicNewEntries(set) : []),
    ...diskBroken(track, expected),
    ...collateralBroken(cell, set),
    ...bystanderRowsBroken(set),
    ...programs
      .flatMap((p) => programBroken(p, set, other, untouched))
      .map(([, detail]): Found => ['collateral', `otra pista, ${detail}`]),
  ]
  return found.map(([invariant, detail]) => ({ invariant, detail }))
}

export interface OriginalFate {
  status: string | undefined
  sourcePath: string
  finalPath: string
  originals: string[]
  osTrash: string[]
  offered: string | null
}

export function originalBroken(o: OriginalFate): Broken[] {
  const source = canonical(o.sourcePath)
  if (o.status === 'ok' || source === canonical(o.finalPath)) return []
  const said = o.status ?? 'ninguno'
  const isSource = (path: string) => canonical(path) === source
  const found: Broken[] = []
  if (o.osTrash.some(isSource))
    found.push({
      invariant: 'unique',
      detail: `papelera: el original fue a la Papelera con el veredicto ${said}`,
    })
  else if (!located(o.sourcePath) && !o.originals.some(isSource))
    found.push({
      invariant: 'unique',
      detail: `papelera: el original se borró con el veredicto ${said}`,
    })
  if (o.offered && isSource(o.offered))
    found.push({
      invariant: 'unique',
      detail: `papelera: se ofrece borrar el original con el veredicto ${said}`,
    })
  return found
}
