import { SAME_CLOCK_FILE } from '../shared/gridEdit'
import { GAPLESS_SIGNATURES, mp3Timing, skippedByFfmpegMs } from './cueCalibration'
import { firstFramePair, leadingTags } from './mp3Head'
import { mp3Head, xingEncoder, xingTagAt } from './rekordboxTimeline'

const MPEG1 = 3
const VBRI_AT = 36

function measuredInTraktor(head: Buffer): boolean {
  const audioAt = leadingTags(head).end
  const frame = firstFramePair(head, audioAt)
  if (frame !== audioAt || ((head[frame + 1] >> 3) & 3) !== MPEG1) return false
  const tagAt = xingTagAt(head, frame)
  if (tagAt === null)
    return head.toString('latin1', frame + VBRI_AT, frame + VBRI_AT + 4) !== 'VBRI'
  const { encoder, delay } = xingEncoder(head, tagAt)
  return GAPLESS_SIGNATURES.includes(encoder) || (encoder === 'Appl' && delay === 0)
}

export async function traktorLeadOfFile(file: string): Promise<number | null> {
  if (SAME_CLOCK_FILE.test(file)) return 0
  if (!/\.mp3$/i.test(file)) return null
  const head = await mp3Head(file).catch(() => null)
  const timing = head && measuredInTraktor(head) ? mp3Timing(head) : null
  return timing ? skippedByFfmpegMs(timing) : null
}
