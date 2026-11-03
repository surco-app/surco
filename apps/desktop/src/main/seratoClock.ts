import { extname } from 'node:path'
import { mp3Head, rekordboxShiftMs } from './rekordboxTimeline'

const M4A_LEAD_SAMPLES = 1024

function isM4a(ext: string): boolean {
  return ext === '.m4a' || ext === '.mp4'
}

export function seratoLeadMs(ext: string, head: Buffer, sampleRate: number): number {
  const kind = ext.toLowerCase()
  if (isM4a(kind)) return -(M4A_LEAD_SAMPLES / sampleRate) * 1000
  if (kind === '.mp3') return rekordboxShiftMs(kind, head, sampleRate)
  return 0
}

export async function seratoLeadOfFile(file: string, sampleRate: number): Promise<number> {
  const ext = extname(file).toLowerCase()
  if (ext !== '.mp3') return seratoLeadMs(ext, Buffer.alloc(0), sampleRate)
  const head = await mp3Head(file)
  return head ? seratoLeadMs(ext, head, sampleRate) : 0
}
