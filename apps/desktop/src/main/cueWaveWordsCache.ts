import { CUE_WAVE_WORDS_NAMESPACE, cachedAnalysis } from './analysisCache'
import { analysisLimiter } from './analysisLimiter'
import { measureCueWaveWords } from './ffmpeg'

export async function cachedCueWaveWords(file: string): Promise<Uint16Array | null> {
  const words = await cachedAnalysis(CUE_WAVE_WORDS_NAMESPACE, file, async () => {
    const measured = await analysisLimiter.run(() => measureCueWaveWords(file), 'high')
    return measured ? Array.from(measured) : null
  })
  return words ? Uint16Array.from(words) : null
}
