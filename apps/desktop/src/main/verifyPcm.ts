import { stat } from 'node:fs/promises'
import { forcedInputArgs } from '../shared/inputFormat'
import { createConcurrencyLimiter } from './analysisLimiter'
import { ffmpegPath } from './binaries'
import { ANALYSIS_TIMEOUT_MS, probeAudio, run } from './ffmpeg'

const pcmLimiter = createConcurrencyLimiter(2)

const SLOW_SHARE_BYTES_PER_SECOND = 2_000_000

const DECODE_MS_PER_AUDIO_SECOND = 100

export function pcmTimeoutMs(sizeBytes: number, headerSeconds?: number): number {
  return Math.max(
    ANALYSIS_TIMEOUT_MS,
    Math.ceil((sizeBytes / SLOW_SHARE_BYTES_PER_SECOND) * 1000),
    Math.ceil((headerSeconds ?? 0) * DECODE_MS_PER_AUDIO_SECOND),
  )
}

export interface PcmDigest {
  md5: string
  sampleRate: number
  channels: number
}

export async function pcmDigest(
  file: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<PcmDigest> {
  const { signal } = opts
  return pcmLimiter.run(
    async () => {
      const [probe, { size }] = await Promise.all([probeAudio(file), stat(file)])
      const float =
        probe.codecName.startsWith('pcm_f') ||
        probe.sampleFmt.startsWith('f') ||
        probe.sampleFmt.startsWith('dbl')
      // Through run, so a WAV whose header ffmpeg refuses is repaired and read like every
      // other pass reads it, instead of failing the one read the check depends on.
      const { stdout } = await run(
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
        { timeout: opts.timeoutMs ?? pcmTimeoutMs(size, probe.headerSeconds), signal },
      )
      const md5 = /^MD5=([0-9a-f]{32})/m.exec(stdout)?.[1]
      if (!md5) throw new Error(`no digest for ${file}`)
      return { md5, sampleRate: Number(probe.sampleRate), channels: probe.channels }
    },
    'low',
    signal,
  )
}
