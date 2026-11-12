import { SAME_CLOCK_FILE } from '../shared/gridEdit'
import { mp3TimingOfFile, skippedByFfmpegMs } from './cueCalibration'

export async function traktorLeadOfFile(file: string): Promise<number | null> {
  if (SAME_CLOCK_FILE.test(file)) return 0
  if (!/\.mp3$/i.test(file)) return null
  const timing = await mp3TimingOfFile(file).catch(() => null)
  return timing ? skippedByFfmpegMs(timing) : null
}
