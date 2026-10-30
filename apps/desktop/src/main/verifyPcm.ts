import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { forcedInputArgs } from '../shared/inputFormat'
import { createConcurrencyLimiter } from './analysisLimiter'
import { ffmpegPath } from './binaries'
import { ANALYSIS_TIMEOUT_MS, probeAudio, probeDuration } from './ffmpeg'

const execFileAsync = promisify(execFile)

const pcmLimiter = createConcurrencyLimiter(2)

const DECODE_MS_PER_AUDIO_SECOND = 100

export function pcmTimeoutMs(durationSeconds: number | null): number {
  return Math.max(ANALYSIS_TIMEOUT_MS, (durationSeconds ?? 0) * DECODE_MS_PER_AUDIO_SECOND)
}

export interface PcmDigest {
  md5: string
  sampleRate: number
  channels: number
}

export async function pcmDigest(
  file: string,
  opts: { signal?: AbortSignal } = {},
): Promise<PcmDigest> {
  const { signal } = opts
  return pcmLimiter.run(
    async () => {
      const [probe, duration] = await Promise.all([probeAudio(file), probeDuration(file, signal)])
      const float =
        probe.codecName.startsWith('pcm_f') ||
        probe.sampleFmt.startsWith('f') ||
        probe.sampleFmt.startsWith('dbl')
      const { stdout } = await execFileAsync(
        ffmpegPath,
        [
          '-v',
          'error',
          ...forcedInputArgs(file),
          '-i',
          file,
          '-map',
          '0:a:0',
          '-c:a',
          float ? 'pcm_f32le' : 'pcm_s32le',
          '-f',
          'md5',
          '-',
        ],
        { timeout: pcmTimeoutMs(duration), signal },
      )
      const md5 = /^MD5=([0-9a-f]{32})/m.exec(stdout)?.[1]
      if (!md5) throw new Error(`no digest for ${file}`)
      return { md5, sampleRate: Number(probe.sampleRate), channels: probe.channels }
    },
    'low',
    signal,
  )
}
