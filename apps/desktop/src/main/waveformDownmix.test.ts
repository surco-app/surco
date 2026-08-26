import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { measureWaveform } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-downmix-'))
const limited = join(dir, 'limited.wav')

// A dual-mono tone mastered to exactly -1.0 dBFS: the shape of a track that came out
// of a true-peak limiter set to the -1 dBTP ceiling Surco defaults to. Both channels
// carry the same signal, which is what makes it a clean probe — an honest mono
// downmix of two identical channels is that same signal, at that same level.
beforeAll(() => {
  // The lavfi sine leaves the generator at -21.072762 dBFS, so this gain lands its
  // sample peak on -1.0 dBFS rather than trusting a nominal amplitude.
  execFileSync(FF, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=997:duration=5:sample_rate=44100',
    '-af',
    'volume=20.072762dB',
    '-ac',
    '2',
    '-c:a',
    'pcm_s16le',
    limited,
    '-y',
  ])
})

describe('waveform downmix level', () => {
  // Why this matters: the editor paints a red clip mark on every bucket whose peak
  // pokes over the normalization ceiling, and the legend counts them as "Peaks over
  // -1.0 dB". Those peaks come from this decode. ffmpeg's bare `-ac 1` applies a
  // power-preserving downmix that multiplies a correlated stereo signal by √2 —
  // +3.01 dB — so a file sitting exactly ON the ceiling decodes to +2 dB and the
  // whole track lights up red. The envelope must carry the file's real level, or
  // every mark drawn against a dB line is measuring an inflated signal.
  it('keeps a -1.0 dBFS master under the ceiling instead of inflating it by the downmix', async () => {
    const wave = await measureWaveform(limited)
    if (!wave) throw new Error('the decode returned no envelope')
    const max = Math.max(...wave.peaks)
    const maxDb = 20 * Math.log10(max)
    // Generous headroom for the 4 kHz decode's resampling ripple (~0.24 dB measured),
    // while still far below the +2.0 dB the √2 downmix produces.
    expect(maxDb).toBeLessThan(-0.5)
  })
})
