import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// cachedAnalysis persists under app.getPath('userData'), so give it a real directory
// of its own: this test is precisely about what the cache does and does not reuse.
vi.mock('electron', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surco-peakdc-cache-'))
  return { app: { getPath: () => dir, isPackaged: false } }
})
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { NormalizeConfig } from '../shared/types'
import { normalizeFilter } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-peakdc-src-'))
const biased = join(dir, 'biased.wav')

const base: NormalizeConfig = {
  mode: 'peak',
  targetLufs: -14,
  peakDb: -1,
  truePeakDb: -1,
  peakPerChannel: true,
}

beforeAll(() => {
  // A 440 Hz tone at 0.4 gain sitting 0.2 above centre. Measured with astats: DC
  // 0.200000, Min 0.150024, Max 0.250000 — a ±0.05 sine on a 0.2 bias, so the extent
  // is 0.25 uncentred and 0.05 centred, a factor of 5 (13.98 dB) between the two.
  execFileSync(FF, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=3',
    '-af',
    'volume=0.4,aeval=val(0)+0.2',
    '-c:a',
    'pcm_s16le',
    biased,
  ])
})

// The astats measurement behind per-channel peak gain is cached by path + mtime under
// a namespace. Centred and uncentred are different measurements of the same unchanged
// file, so they need different namespaces — exactly as volumedetect's key already does
// with its own '-dc' suffix. Sharing one would let whichever ran first decide the gain
// for both, and a cache entry outlives the session: the wrong gain would be pinned for
// as long as the file is untouched, which is what makes this worth a test of its own
// rather than trusting the conversion test alone (that one starts from a cold cache
// and so can never observe the collision).
describe('la clave de caché distingue la medida centrada de la sesgada', () => {
  it('no sirve la medida sin centrar a una conversión que sí centra', async () => {
    // Uncentred first, so its entry is the one already sitting in the cache.
    const withoutDc = await normalizeFilter(biased, base)
    const withDc = await normalizeFilter(biased, { ...base, removeDcOffset: true })

    expect(withoutDc, 'sin centrar tiene que producir un filtro').not.toBeNull()
    expect(withDc, 'centrando tiene que producir un filtro').not.toBeNull()

    // The gains are the numbers that differ: uncentred sizes against an extent of
    // 0.25, centred against 0.05. If the cache served the first measurement to the
    // second call, both filters carry the same multiplier.
    const gains = (filter: string): string[] => [...filter.matchAll(/\*([\d.]+)/g)].map((m) => m[1])

    expect(
      gains(withDc as string),
      'la conversión centrada reutilizó la medida sesgada',
    ).not.toEqual(gains(withoutDc as string))
  })

  it('sí reutiliza la medida cuando la segunda llamada pide lo mismo', async () => {
    // The other half of the contract: the suffix must not defeat caching for repeats
    // of the SAME request, which is what the memoization exists for.
    const first = await normalizeFilter(biased, { ...base, removeDcOffset: true })
    const second = await normalizeFilter(biased, { ...base, removeDcOffset: true })

    expect(second).toEqual(first)
  })
})
