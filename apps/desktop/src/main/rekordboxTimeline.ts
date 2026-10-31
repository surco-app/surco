import { open } from 'node:fs/promises'
import { extname } from 'node:path'
import { leadingId3v2Size } from './id3Header'

const HEAD_SCAN_BYTES = 1 << 20
const ID3V2_HEADER_BYTES = 10
const MPEG1_SAMPLE_RATES = [44100, 48000, 32000]
const MPEG1_FRAME_SAMPLES = 1152
const MP3_DECODER_DELAY = 529
const APPLE_AAC_PRIMING = 2112
const MP4_BOX_HEADER_BYTES = 8
const MP4_MAX_MOOV_BYTES = 64 << 20
const XING_FIELD_BYTES = [
  [1, 4],
  [2, 4],
  [4, 100],
  [8, 4],
] as const

function mpeg1Layer3At(head: Buffer, at: number): boolean {
  return (
    head[at] === 0xff &&
    (head[at + 1] & 0xfe) === 0xfa &&
    head[at + 2] >> 4 !== 0 &&
    head[at + 2] >> 4 !== 15 &&
    ((head[at + 2] >> 2) & 3) !== 3
  )
}

function firstFrame(head: Buffer): number | null {
  let at = 0
  for (let size = leadingId3v2Size(head); size > 0; size = leadingId3v2Size(head.subarray(at)))
    at += size
  for (; at + 4 <= head.length; at++) {
    if (head[at] === 0xff && (head[at + 1] & 0xe0) === 0xe0)
      return mpeg1Layer3At(head, at) ? at : null
  }
  return null
}

export interface Mpeg1Info {
  sampleRate: number
  encoder: string
  delay: number
}

export function xingTagAt(head: Buffer, frame: number): number | null {
  const mpeg1 = ((head[frame + 1] >> 3) & 3) === 3
  const mono = head[frame + 3] >> 6 === 3
  const tagAt = frame + 4 + (mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17)
  const tag = head.toString('latin1', tagAt, tagAt + 4)
  return tag === 'Info' || tag === 'Xing' ? tagAt : null
}

export function xingEncoder(head: Buffer, tagAt: number): { encoder: string; delay: number } {
  const flags = head.readUInt32BE(tagAt + 4)
  const encoderAt = XING_FIELD_BYTES.reduce(
    (at, [flag, bytes]) => (flags & flag ? at + bytes : at),
    tagAt + 8,
  )
  return {
    encoder: head.toString('latin1', encoderAt, encoderAt + 4),
    delay: (head[encoderAt + 21] << 4) | (head[encoderAt + 22] >> 4),
  }
}

export function mpeg1Info(head: Buffer): Mpeg1Info | null {
  const frame = firstFrame(head)
  if (frame === null) return null
  const tagAt = xingTagAt(head, frame)
  if (tagAt === null) return null
  return { sampleRate: MPEG1_SAMPLE_RATES[(head[frame + 2] >> 2) & 3], ...xingEncoder(head, tagAt) }
}

export function rekordboxLeadMs(head: Buffer): number {
  const info = mpeg1Info(head)
  if (info?.encoder !== 'LAME') return 0
  return (MPEG1_FRAME_SAMPLES / info.sampleRate) * 1000
}

interface Mp4Box {
  type: string
  body: number
  end: number
}

function* mp4Boxes(buf: Buffer, start: number, end: number): Generator<Mp4Box> {
  for (let at = start; at + MP4_BOX_HEADER_BYTES <= end; ) {
    const size = buf.readUInt32BE(at)
    if (size < MP4_BOX_HEADER_BYTES || at + size > end) return
    yield {
      type: buf.toString('latin1', at + 4, at + 8),
      body: at + MP4_BOX_HEADER_BYTES,
      end: at + size,
    }
    at += size
  }
}

function mp4Child(buf: Buffer, path: string[], start = 0, end = buf.length): Mp4Box | undefined {
  const [type, ...rest] = path
  for (const b of mp4Boxes(buf, start, end))
    if (b.type === type) return rest.length ? mp4Child(buf, rest, b.body, b.end) : b
  return undefined
}

function editListStart(buf: Buffer, elst: Mp4Box): number | undefined {
  if (elst.body + 8 > elst.end) return undefined
  const wide = buf[elst.body] === 1
  const count = buf.readUInt32BE(elst.body + 4)
  for (let i = 0, at = elst.body + 8; i < count && at + (wide ? 20 : 12) <= elst.end; i++) {
    const mediaTime = wide ? Number(buf.readBigInt64BE(at + 8)) : buf.readInt32BE(at + 4)
    if (mediaTime >= 0) return mediaTime
    at += wide ? 20 : 12
  }
  return undefined
}

function itunSmpbPriming(buf: Buffer): number | undefined {
  const name = buf.indexOf('iTunSMPB', 0, 'latin1')
  if (name < 0) return undefined
  const data = buf.indexOf('data', name, 'latin1')
  if (data < 0) return undefined
  const fields = buf
    .toString('latin1', data + 12, data + 12 + 64)
    .trim()
    .split(/\s+/)
  const priming = Number.parseInt(fields[1] ?? '', 16)
  return Number.isNaN(priming) ? undefined : priming
}

function soundTrack(buf: Buffer, moov: Mp4Box): Mp4Box | undefined {
  for (const trak of mp4Boxes(buf, moov.body, moov.end)) {
    const hdlr = trak.type === 'trak' && mp4Child(buf, ['mdia', 'hdlr'], trak.body, trak.end)
    if (hdlr && buf.toString('latin1', hdlr.body + 8, hdlr.body + 12) === 'soun') return trak
  }
  return undefined
}

function mediaTimescale(buf: Buffer, trak: Mp4Box): number | undefined {
  const mdhd = mp4Child(buf, ['mdia', 'mdhd'], trak.body, trak.end)
  if (!mdhd) return undefined
  const at = mdhd.body + (buf[mdhd.body] === 1 ? 20 : 12)
  return at + 4 <= mdhd.end ? buf.readUInt32BE(at) || undefined : undefined
}

export function m4aPrimingMs(moov: Buffer, sampleRate: number): number {
  const root = mp4Child(moov, ['moov'])
  if (!root) return (APPLE_AAC_PRIMING / sampleRate) * 1000
  const trak = soundTrack(moov, root)
  const stsd = trak && mp4Child(moov, ['mdia', 'minf', 'stbl', 'stsd'], trak.body, trak.end)
  if (stsd && moov.toString('latin1', stsd.body + 12, stsd.body + 16) === 'alac') return 0
  const elst = trak && mp4Child(moov, ['edts', 'elst'], trak.body, trak.end)
  const edit = elst && editListStart(moov, elst)
  if (trak && edit !== undefined) return (edit / (mediaTimescale(moov, trak) ?? sampleRate)) * 1000
  return ((itunSmpbPriming(moov) ?? 0) / sampleRate) * 1000
}

export function rekordboxShiftMs(ext: string, head: Buffer, sampleRate: number): number {
  const kind = ext.toLowerCase()
  if (kind === '.m4a') return m4aPrimingMs(head, sampleRate)
  if (kind !== '.mp3') return 0
  const info = mpeg1Info(head)
  if (!info) return 0
  const skipped = info.encoder === 'LAME' ? info.delay + MP3_DECODER_DELAY : 0
  return ((MPEG1_FRAME_SAMPLES + skipped) / info.sampleRate) * 1000
}

export async function mp3Head(file: string): Promise<Buffer | null> {
  if (extname(file).toLowerCase() !== '.mp3') return null
  let fh: Awaited<ReturnType<typeof open>>
  try {
    fh = await open(file, 'r')
  } catch {
    return null
  }
  try {
    const tagHeader = Buffer.alloc(ID3V2_HEADER_BYTES)
    let audioAt = 0
    for (;;) {
      const { bytesRead } = await fh.read(tagHeader, 0, ID3V2_HEADER_BYTES, audioAt)
      const size = leadingId3v2Size(tagHeader.subarray(0, bytesRead))
      if (size === 0) break
      audioAt += size
    }
    const head = Buffer.alloc(HEAD_SCAN_BYTES)
    const { bytesRead } = await fh.read(head, 0, HEAD_SCAN_BYTES, audioAt)
    return head.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

export async function rekordboxLeadOfFile(file: string): Promise<number> {
  const head = await mp3Head(file)
  return head ? rekordboxLeadMs(head) : 0
}

async function m4aMoov(file: string): Promise<Buffer> {
  let fh: Awaited<ReturnType<typeof open>>
  try {
    fh = await open(file, 'r')
  } catch {
    return Buffer.alloc(0)
  }
  try {
    const { size: fileSize } = await fh.stat()
    const header = Buffer.alloc(16)
    for (let at = 0; at + MP4_BOX_HEADER_BYTES <= fileSize; ) {
      await fh.read(header, 0, 16, at)
      const short = header.readUInt32BE(0)
      const size =
        short === 1 ? Number(header.readBigUInt64BE(8)) : short === 0 ? fileSize - at : short
      if (size < MP4_BOX_HEADER_BYTES) break
      if (header.toString('latin1', 4, 8) === 'moov') {
        const moov = Buffer.alloc(Math.min(size, MP4_MAX_MOOV_BYTES))
        const { bytesRead } = await fh.read(moov, 0, moov.length, at)
        return moov.subarray(0, bytesRead)
      }
      at += size
    }
    return Buffer.alloc(0)
  } finally {
    await fh.close()
  }
}

export async function rekordboxShiftOfFile(file: string, sampleRate: number): Promise<number> {
  const ext = extname(file)
  if (ext.toLowerCase() === '.m4a') return rekordboxShiftMs(ext, await m4aMoov(file), sampleRate)
  if (ext.toLowerCase() !== '.mp3') return rekordboxShiftMs(ext, Buffer.alloc(0), sampleRate)
  const head = await mp3Head(file)
  return head ? rekordboxShiftMs(ext, head, sampleRate) : 0
}
