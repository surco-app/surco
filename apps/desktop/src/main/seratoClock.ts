import { extname } from 'node:path'
import { mp3Head, mpeg1Info } from './rekordboxTimeline'

const M4A_LEAD_SAMPLES = 1024
const MP3_FRAME_SAMPLES = 1152
const MP3_DECODER_DELAY = 529
const DELAY_WRITERS = new Set(['LAME', 'Lavc', 'Lavf'])

function isM4a(ext: string): boolean {
  return ext === '.m4a' || ext === '.mp4'
}

function mp3LeadMs(head: Buffer): number {
  const info = mpeg1Info(head)
  if (!info) return 0
  const skipped = DELAY_WRITERS.has(info.encoder) ? info.delay + MP3_DECODER_DELAY : 0
  return ((MP3_FRAME_SAMPLES + skipped) / info.sampleRate) * 1000
}

export function seratoLeadMs(ext: string, head: Buffer, sampleRate: number): number {
  const kind = ext.toLowerCase()
  if (isM4a(kind)) return -(M4A_LEAD_SAMPLES / sampleRate) * 1000
  if (kind === '.mp3') return mp3LeadMs(head)
  return 0
}

export async function seratoLeadOfFile(file: string, sampleRate: number): Promise<number> {
  const ext = extname(file).toLowerCase()
  if (ext !== '.mp3') return seratoLeadMs(ext, Buffer.alloc(0), sampleRate)
  const head = await mp3Head(file)
  return head ? seratoLeadMs(ext, head, sampleRate) : 0
}
