import { open } from 'node:fs/promises'
import { leadingId3v2Size } from './id3Header'

const HEAD_SCAN_BYTES = 1 << 20
const TAGLIB_HEADER_REACH = 1024
const MPEG_HEADER_BYTES = 4
const ID3V2_HEADER_BYTES = 10
const ID3V2_FOOTER_FLAG = 0x10

const MPEG1_BITRATES_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const MPEG2_BITRATES_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
const MPEG1_SAMPLE_RATES = [44100, 48000, 32000]

function layer3FrameLength(buf: Buffer, at: number): number | null {
  if (at + MPEG_HEADER_BYTES > buf.length) return null
  if (buf[at] !== 0xff || (buf[at + 1] & 0xe0) !== 0xe0) return null
  const version = (buf[at + 1] >> 3) & 3
  const layer = (buf[at + 1] >> 1) & 3
  if (version === 1 || layer !== 1) return null
  const bitrateIndex = buf[at + 2] >> 4
  const sampleRateIndex = (buf[at + 2] >> 2) & 3
  const padding = (buf[at + 2] >> 1) & 1
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null
  const mpeg1 = version === 3
  const bitrate = (mpeg1 ? MPEG1_BITRATES_KBPS : MPEG2_BITRATES_KBPS)[bitrateIndex] * 1000
  const divisor = version === 3 ? 1 : version === 2 ? 2 : 4
  const sampleRate = MPEG1_SAMPLE_RATES[sampleRateIndex] / divisor
  return Math.floor(((mpeg1 ? 144 : 72) * bitrate) / sampleRate) + padding
}

function firstFramePair(buf: Buffer, from: number): number | null {
  for (let at = from; at + MPEG_HEADER_BYTES <= buf.length; at++) {
    const length = layer3FrameLength(buf, at)
    if (length !== null && layer3FrameLength(buf, at + length) !== null) return at
  }
  return null
}

function leadingTags(buf: Buffer): { lastStart: number | null; end: number } {
  let lastStart: number | null = null
  let end = 0
  for (;;) {
    const size = leadingId3v2Size(buf.subarray(end))
    if (size === 0) return { lastStart, end }
    lastStart = end
    end += size
  }
}

function writeSyncsafe(buf: Buffer, at: number, value: number): void {
  buf[at] = (value >> 21) & 0x7f
  buf[at + 1] = (value >> 14) & 0x7f
  buf[at + 2] = (value >> 7) & 0x7f
  buf[at + 3] = value & 0x7f
}

export function absorbedHead(head: Buffer): Buffer | null {
  const { lastStart, end } = leadingTags(head)
  const frame = firstFramePair(head, end)
  if (frame === null) return null
  if (frame - end + MPEG_HEADER_BYTES <= TAGLIB_HEADER_REACH) return null
  const patched = Buffer.from(head.subarray(0, frame))
  if (lastStart === null) {
    patched.fill(0, 0, frame)
    patched.write('ID3', 0, 'latin1')
    patched[3] = 3
    writeSyncsafe(patched, 6, frame - ID3V2_HEADER_BYTES)
    return patched
  }
  if (head[lastStart + 5] & ID3V2_FOOTER_FLAG) return null
  patched.fill(0, end, frame)
  writeSyncsafe(patched, lastStart + 6, frame - lastStart - ID3V2_HEADER_BYTES)
  return patched
}

export async function absorbMp3HeadJunk(file: string): Promise<boolean> {
  const fh = await open(file, 'r+')
  try {
    const head = Buffer.alloc(HEAD_SCAN_BYTES)
    const { bytesRead } = await fh.read(head, 0, HEAD_SCAN_BYTES, 0)
    const patched = absorbedHead(head.subarray(0, bytesRead))
    if (!patched) return false
    await fh.write(patched, 0, patched.length, 0)
    return true
  } finally {
    await fh.close()
  }
}
