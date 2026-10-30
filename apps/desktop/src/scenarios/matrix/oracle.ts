import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
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
import type { OutputFormat } from '../../shared/types'
import type { Cell, InvariantName } from './cells'
import type { SourceTrack, TrickyTags } from './sources'

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
    ...tagsBroken(cell.target, source.tags, path, out).map(as('tags')),
    ...coverBroken(cell.target, path, expectedCoverSha1).map(as('cover')),
  ]
}
