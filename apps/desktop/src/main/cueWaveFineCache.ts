import { cachedAnalysis } from './analysisCache'
import { analysisLimiter } from './analysisLimiter'
import { measureCueWaveFine } from './ffmpeg'

export const CUE_WAVE_FINE_NAMESPACE = 'cue-wave-fine-v1'

export async function cachedCueWaveFine(file: string): Promise<Uint8Array | null> {
  const stored = await cachedAnalysis(CUE_WAVE_FINE_NAMESPACE, file, async () => {
    const measured = await analysisLimiter.run(() => measureCueWaveFine(file), 'high')
    return measured ? Buffer.from(measured).toString('base64') : null
  })
  return stored ? new Uint8Array(Buffer.from(stored, 'base64')) : null
}
