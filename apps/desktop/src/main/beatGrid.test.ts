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
