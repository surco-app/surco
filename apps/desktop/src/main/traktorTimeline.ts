import { SAME_CLOCK_FILE } from '../shared/gridEdit'
import { mp3Head, mpeg1Info } from './rekordboxTimeline'

export const TRAKTOR_ITUNES_MP3_LEAD_MS = 27

export async function traktorLeadOfFile(file: string): Promise<number | null> {
  if (SAME_CLOCK_FILE.test(file)) return 0
  if (!/\.mp3$/i.test(file)) return null
  const head = await mp3Head(file).catch(() => null)
  const info = head ? mpeg1Info(head) : null
  return info?.encoder === 'Appl' && info.delay === 0 ? TRAKTOR_ITUNES_MP3_LEAD_MS : null
}
