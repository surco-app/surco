import { open } from 'node:fs/promises'
import { extname } from 'node:path'
import { leadingId3v2Size } from './id3Header'

const HEAD_SCAN_BYTES = 1 << 20
const MPEG1_SAMPLE_RATES = [44100, 48000, 32000]
const MPEG1_FRAME_SAMPLES = 1152
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

export function rekordboxLeadMs(head: Buffer): number {
  const frame = firstFrame(head)
  if (frame === null) return 0
  const mono = head[frame + 3] >> 6 === 3
  const tagAt = frame + 4 + (mono ? 17 : 32)
  const tag = head.toString('latin1', tagAt, tagAt + 4)
  if (tag !== 'Info' && tag !== 'Xing') return 0
  const flags = head.readUInt32BE(tagAt + 4)
  const encoderAt = XING_FIELD_BYTES.reduce(
    (at, [flag, bytes]) => (flags & flag ? at + bytes : at),
    tagAt + 8,
  )
  if (head.toString('latin1', encoderAt, encoderAt + 4) !== 'LAME') return 0
  const sampleRate = MPEG1_SAMPLE_RATES[(head[frame + 2] >> 2) & 3]
  return (MPEG1_FRAME_SAMPLES / sampleRate) * 1000
}

export async function rekordboxLeadOfFile(file: string): Promise<number> {
  if (extname(file).toLowerCase() !== '.mp3') return 0
  let fh: Awaited<ReturnType<typeof open>>
  try {
    fh = await open(file, 'r')
  } catch {
    return 0
  }
  try {
    const head = Buffer.alloc(HEAD_SCAN_BYTES)
    const { bytesRead } = await fh.read(head, 0, HEAD_SCAN_BYTES, 0)
    return rekordboxLeadMs(head.subarray(0, bytesRead))
  } finally {
    await fh.close()
  }
}
