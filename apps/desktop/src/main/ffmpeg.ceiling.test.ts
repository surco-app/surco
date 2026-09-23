import { beforeEach, describe, expect, it, vi } from 'vitest'

const warn = vi.fn()
vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))
vi.mock('electron-log/main', () => ({
  default: { warn: (...args: unknown[]) => warn(...args), error: vi.fn(), info: vi.fn() },
}))

import { holdUnderCeiling } from './ffmpeg'

const CEILING = -1

const linear = (marginDb: number) =>
  `loudnorm=I=-14:TP=${(CEILING - marginDb).toFixed(2)}:linear=true`
const limited = (marginDb: number) => `volume=5dB,alimiter=limit=${(CEILING - marginDb).toFixed(2)}`

function trimOf(filter: string): number {
  return [...filter.matchAll(/volume=-([\d.]+)dB/g)].reduce((sum, m) => sum + Number(m[1]), 0)
}

function limitOf(filter: string): number | null {
  const m = filter.match(/alimiter=limit=(-?[\d.]+)/)
  return m ? Number(m[1]) : null
}

function encoder(peakOf: (filter: string) => number) {
  const encoded: string[] = []
  let written = ''
  let measured = 0
  return {
    encoded,
    measured: () => measured,
    steps: (lowerCeiling: (marginDb: number) => Promise<string | null>) => ({
      lowerCeiling,
      encode: async (filter: string) => {
        encoded.push(filter)
        written = filter
        return `stderr ${encoded.length}`
      },
      overshootDb: async () => {
        measured++
        return Math.max(0, Math.round((peakOf(written) - CEILING) * 10) / 10)
      },
    }),
    peak: () => Math.round(peakOf(written) * 10) / 10,
  }
}

async function run(
  first: string,
  peakOf: (filter: string) => number,
  lowerCeiling: (marginDb: number) => Promise<string | null>,
) {
  const e = encoder(peakOf)
  const steps = e.steps(lowerCeiling)
  await steps.encode(first)
  const stderr = await holdUnderCeiling('stderr 1', first, steps)
  return { ...e, stderr }
}

beforeEach(() => warn.mockClear())

describe('holding an encoded file under its true-peak ceiling', () => {
  it('measures the file the last correction wrote, so an encode that still overshoots is never trusted', async () => {
    const r = await run(
      limited(0),
      (f) => CEILING + 0.5 + ((limitOf(f) ?? CEILING) - CEILING) * 0.5 - trimOf(f),
      async (m) => limited(m),
    )
    expect(r.measured()).toBe(r.encoded.length)
    expect(r.peak()).toBeLessThanOrEqual(CEILING)
  })

  it('lowers the gain when a lowered ceiling leaves a constant-gain filter sounding the same', async () => {
    const r = await run(
      linear(0),
      (f) => CEILING + 0.1 + 0.7 - trimOf(f),
      async (m) => linear(m),
    )
    expect(r.encoded.length).toBeGreaterThan(1)
    expect(trimOf(r.encoded[1])).toBeGreaterThan(0)
    expect(r.peak()).toBeLessThanOrEqual(CEILING)
  })

  it('cuts deeper on every re-encode of a constant-gain filter, whose lowered TP alone changes nothing', async () => {
    const r = await run(
      linear(0),
      (f) => CEILING + 0.8 - trimOf(f) * 0.6,
      async (m) => linear(m),
    )
    const trims = r.encoded.map(trimOf)
    expect(trims.length).toBeGreaterThan(2)
    expect(trims).toEqual([...trims].sort((a, b) => a - b))
    expect(new Set(trims).size).toBe(trims.length)
    expect(r.peak()).toBeLessThanOrEqual(CEILING)
  })

  it('falls back to a constant gain cut when lowering the limiter barely moves the encoded peaks', async () => {
    const r = await run(
      limited(0),
      (f) => CEILING + 0.6 + ((limitOf(f) ?? CEILING) - CEILING) * 0.3 - trimOf(f),
      async (m) => limited(m),
    )
    expect(trimOf(r.encoded[r.encoded.length - 1])).toBeGreaterThan(0)
    expect(r.peak()).toBeLessThanOrEqual(CEILING)
    expect(warn).not.toHaveBeenCalled()
  })

  it('cuts the gain when the ceiling filter cannot be rebuilt', async () => {
    const r = await run(
      limited(0),
      (f) => CEILING + 0.4 - trimOf(f),
      async () => null,
    )
    expect(r.peak()).toBeLessThanOrEqual(CEILING)
  })

  it('stops after a bounded number of encodes and logs a file it could not bring under', async () => {
    const r = await run(
      limited(0),
      () => 0,
      async (m) => limited(m),
    )
    expect(r.encoded.length).toBeLessThanOrEqual(4)
    expect(r.measured()).toBe(r.encoded.length)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('leaves a file already under the ceiling alone', async () => {
    const r = await run(
      linear(0),
      () => CEILING - 0.5,
      async (m) => linear(m),
    )
    expect(r.encoded).toHaveLength(1)
    expect(r.stderr).toBe('stderr 1')
  })

  it('returns the stderr of the encode that produced the final file', async () => {
    const r = await run(
      linear(0),
      (f) => CEILING + 0.3 - trimOf(f),
      async (m) => linear(m),
    )
    expect(r.stderr).toBe(`stderr ${r.encoded.length}`)
  })
})
