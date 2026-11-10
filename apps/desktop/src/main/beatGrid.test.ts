import { describe, expect, it } from 'vitest'
import { fitBeatGrid, provisionalGrid } from './beatGrid'
import { TEMPO_SAMPLE_RATE } from './tempo'

const SR = TEMPO_SAMPLE_RATE

function danceTrack(bpm: number, firstMs: number, seconds: number): Float32Array {
  const pcm = new Float32Array(SR * seconds)
  const period = 60 / bpm
  let noise = 1
  for (let i = 0; i < pcm.length; i++) {
    const t = i / SR - firstMs / 1000
    if (t < 0) continue
    const inBeat = t % period
    const kick = 0.6 * Math.sin(2 * Math.PI * 55 * inBeat) * Math.exp(-inBeat * 40)
    const swell =
      0.9 * Math.sin(2 * Math.PI * 80 * inBeat) * Math.exp(-((inBeat - 0.12) ** 2) * 300)
    const off = (inBeat + period / 2) % period
    noise = (noise * 16807) % 2147483647
    const hat = 0.15 * (noise / 2147483647 - 0.5) * Math.exp(-off * 120)
    pcm[i] = kick + swell + hat
  }
  return pcm
}

const phaseError = (fitMs: number, trueMs: number, bpm: number): number => {
  const period = 60000 / bpm
  const d = (((fitMs - trueMs) % period) + period) % period
  return Math.min(d, period - d)
}

describe('fitBeatGrid', () => {
  it('puts the beat where the kick starts, not where its bass swells to the loudest point a tenth of a second later', () => {
    const fit = fitBeatGrid(danceTrack(140, 250, 90), SR)
    if (!fit) throw new Error('a steady kick must fit a grid')
    expect(fit.bpm).toBeCloseTo(140, 1)
    expect(phaseError(fit.firstMs, 250, 140)).toBeLessThan(5)
  })

  it('pins the tempo to a hundredth, so a cue 48 bars from the drop still lands on its beat', () => {
    const bpm = 147.76
    const fit = fitBeatGrid(danceTrack(bpm, 400, 180), SR)
    if (!fit) throw new Error('a steady kick must fit a grid')
    const beat = 400
    const truth = 400 + (beat * 60000) / bpm
    const fitted =
      fit.firstMs + (Math.round((truth - fit.firstMs) / (60000 / fit.bpm)) * 60000) / fit.bpm
    expect(Math.abs(fitted - truth)).toBeLessThan(10)
  })

  it('returns the first beat inside the first period, whatever the intro', () => {
    const fit = fitBeatGrid(danceTrack(130, 2000, 60), SR)
    if (!fit) throw new Error('a steady kick must fit a grid')
    expect(fit.firstMs).toBeGreaterThanOrEqual(0)
    expect(fit.firstMs).toBeLessThan(60000 / fit.bpm)
  })

  it('measures where the beat falls in each stretch of the track, so a spliced intro shows up even when the rest dominates the fit', () => {
    const intro = danceTrack(150, 250, 60)
    const rest = danceTrack(150, 275, 180)
    const pcm = new Float32Array(SR * 180)
    pcm.set(intro)
    pcm.set(rest.subarray(SR * 60), SR * 60)
    const fit = fitBeatGrid(pcm, SR)
    if (!fit?.phases) throw new Error('a steady kick must fit a grid with phases')
    const missAt = (ms: number, trueFirst: number) => {
      const phases = fit.phases ?? []
      const near = phases.reduce((a, b) => (Math.abs(b.ms - ms) < Math.abs(a.ms - ms) ? b : a))
      const truth = trueFirst + Math.round((ms - trueFirst) / 400) * 400
      const period = 60000 / fit.bpm
      const detected = near.firstMs + Math.round((truth - near.firstMs) / period) * period
      return Math.abs(detected - truth)
    }
    expect(missAt(20000, 250)).toBeLessThan(6)
    expect(missAt(150000, 275)).toBeLessThan(6)
  })

  it('leaves the silent stretches out of the phases, where there is no beat to place', () => {
    const pcm = new Float32Array(SR * 120)
    pcm.set(danceTrack(150, 250, 60).subarray(0, SR * 60), SR * 60)
    const fit = fitBeatGrid(pcm, SR)
    expect(fit?.phases?.every((p) => p.ms > 55000)).toBe(true)
  })

  it('fits nothing on silence rather than a confident-looking grid', () => {
    expect(fitBeatGrid(new Float32Array(SR * 30), SR)).toBeNull()
  })
})

describe('provisionalGrid', () => {
  const fit = { bpm: 120, firstMs: 100 }

  it('moves every beat by how far rekordbox times the file ahead of the decode', () => {
    expect(
      provisionalGrid(fit, 51, 2000)
        .slice(0, 3)
        .map((b) => b.ms),
    ).toEqual([153, 653, 1153])
  })

  it('marks no beat as a downbeat, because where the bar starts is the one thing Surco cannot tell', () => {
    expect(provisionalGrid(fit, 0, 10000).every((b) => b.beat === 0)).toBe(true)
  })

  it('covers the whole track and nothing past its end', () => {
    const grid = provisionalGrid(fit, 0, 10000)
    expect(grid.at(-1)?.ms).toBeLessThan(10000)
    expect(grid).toHaveLength(20)
  })
})

function wobblingTrack(
  bpm: number,
  seconds: number,
  wobbleMs: (s: number) => number,
  noiseFrom = Infinity,
  noiseTo = Infinity,
): Float32Array {
  const pcm = new Float32Array(SR * seconds)
  const period = 60 / bpm
  let noise = 1
  for (let i = 0; i < pcm.length; i++) {
    const s = i / SR
    noise = (noise * 16807) % 2147483647
    const white = noise / 2147483647 - 0.5
    if (s >= noiseFrom && s < noiseTo) {
      pcm[i] = 0.4 * white
      continue
    }
    const t = s - 0.25 - wobbleMs(s) / 1000
    if (t < 0) continue
    const inBeat = t % period
    pcm[i] = 0.6 * Math.sin(2 * Math.PI * 55 * inBeat) * Math.exp(-inBeat * 40) + 0.02 * white
  }
  return pcm
}

describe('fine measurements along the track', () => {
  const wobble = (s: number) => 10 * Math.sin((2 * Math.PI * s) / 60)

  it('follows a master whose tempo breathes a few ms over a minute, which the long stretches average away', () => {
    const fit = fitBeatGrid(wobblingTrack(140, 120, wobble), SR)
    if (!fit?.fine) throw new Error('a clear kick must give fine measurements')
    const period = 60000 / fit.bpm
    const at = (p: { ms: number; firstMs: number }) => {
      const d = p.firstMs - fit.firstMs
      return d - Math.round(d / period) * period
    }
    const base = at(fit.fine[0]) - wobble(fit.fine[0].ms / 1000)
    const misses = fit.fine.filter((p) => Math.abs(at(p) - base - wobble(p.ms / 1000)) > 4)
    expect(fit.fine.length).toBeGreaterThan(40)
    expect(misses.length).toBeLessThanOrEqual(fit.fine.length * 0.05)
  })

  it('gives no fine measurement where there is no beat to hear, so a noisy break cannot bend the grid', () => {
    const fit = fitBeatGrid(
      wobblingTrack(140, 120, () => 0, 50, 70),
      SR,
    )
    if (!fit?.fine) throw new Error('a clear kick must give fine measurements')
    expect(fit.fine.filter((p) => p.ms > 52000 && p.ms < 68000)).toEqual([])
    expect(fit.fine.filter((p) => p.ms < 48000).length).toBeGreaterThan(15)
  })
})
