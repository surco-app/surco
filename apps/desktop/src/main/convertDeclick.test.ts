import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio, detectTrackClicks, renderDeclickRepaired } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-declick-'))
const src = join(dir, 'in.wav')

const meta: TrackMetadata = {
  title: 'Crackle',
  artist: 'Dust',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

// Decodes the whole file to float and reads the absolute peak, so the assertions
// measure real samples instead of parsing volumedetect's stderr prose.
function peakOf(file: string): number {
  const raw = execFileSync(FF, ['-v', 'error', '-i', file, '-f', 'f32le', '-'], {
    maxBuffer: 1024 * 1024 * 64,
  })
  const s = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4)
  let max = 0
  for (let i = 0; i < s.length; i++) {
    const a = Math.abs(s[i])
    if (a > max) max = a
  }
  return max
}

beforeAll(() => {
  // What a vinyl rip's clicks look like: a -12 dB sine with a ~2-sample near-full-scale
  // impulse every half second (the parentheses keep aevalsrc's commas out of the
  // filtergraph separator). The clicks ARE the file's peak — exactly the shape that
  // fools a peak-normalize gain.
  execFileSync(FF, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'aevalsrc=0.25*sin(2*PI*440*t)+if(lt(mod(t\\,0.5)\\,0.00004)\\,0.9\\,0):s=44100:d=4',
    '-c:a',
    'pcm_s16le',
    src,
  ])
})

// End-to-end through the real convertAudio pipeline and the bundled ffmpeg: the unit
// tests assert the planned filter strings, this asserts the samples ffmpeg writes.
describe('convertAudio declick', () => {
  it('repairs stylus clicks and reports the repaired-sample count', async () => {
    const out = join(dir, 'out.wav')
    const result = await convertAudio(
      src,
      out,
      'wav',
      meta,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'standard',
    )
    // The 0.9 impulses are gone, leaving the 0.25 sine as the true peak — and the
    // same-format source was re-encoded (a stream copy would have kept the clicks).
    expect(peakOf(out)).toBeLessThan(0.3)
    expect(result.declickedSamples).toBeGreaterThan(0)
  }, 30000)

  it('still repairs stylus clicks at the gentle step', async () => {
    // Gentle raises the detection threshold to touch less music; near-full-scale
    // clicks must stay well above it, or the step would be a placebo.
    const out = join(dir, 'out-soft.wav')
    const result = await convertAudio(
      src,
      out,
      'wav',
      meta,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'soft',
    )
    expect(peakOf(out)).toBeLessThan(0.3)
    expect(result.declickedSamples).toBeGreaterThan(0)
  }, 30000)

  it('repairs long pops in strong mode that the standard defaults leave behind', async () => {
    // ~9-sample bursts: adeclick's defaults detect but cannot fuse them into one
    // repairable burst, so they survive standard mode — the exact gap the strong
    // preset (max burst fusion) exists for.
    const pops = join(dir, 'in-pops.wav')
    execFileSync(FF, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'aevalsrc=0.25*sin(2*PI*440*t)+if(lt(mod(t\\,0.5)\\,0.0002)\\,0.9\\,0):s=44100:d=4',
      '-c:a',
      'pcm_s16le',
      pops,
    ])
    const out = join(dir, 'out-pops.wav')
    const result = await convertAudio(
      pops,
      out,
      'wav',
      meta,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'strong',
    )
    expect(peakOf(out)).toBeLessThan(0.3)
    expect(result.declickedSamples).toBeGreaterThan(0)
  }, 30000)

  it('sizes a peak-normalize gain on the repaired audio, not the click peak', async () => {
    const out = join(dir, 'out-normalized.wav')
    await convertAudio(
      src,
      out,
      'wav',
      meta,
      undefined,
      { mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'standard',
    )
    // Measured through the click (peak ~0 dB) the gain would be ~-1 dB and the sine
    // would land near 0.22; measured on the repaired audio (-12 dB) it boosts the
    // sine to the -1 dBFS target (~0.89).
    const peak = peakOf(out)
    expect(peak).toBeGreaterThan(0.6)
    expect(peak).toBeLessThan(0.95)
  }, 30000)

  it('reports nothing when declick is off, so "not run" stays distinct from "0 repaired"', async () => {
    const out = join(dir, 'out-off.flac')
    const result = await convertAudio(src, out, 'flac', meta)
    expect(result.declickedSamples).toBeUndefined()
  }, 30000)
})

// The A/B preview: the render is what the user hears and judges, so it must be the
// repaired *music* — clicks gone, the track still there. (Its predecessor rendered only
// the removed clicks, which proved the filter fired but hid the failure that matters:
// a repair that eats a snare's attack sounds like just another click in that signal.)
describe('renderDeclickRepaired', () => {
  it('renders the repaired track: clicks gone, music intact', async () => {
    const out = join(dir, 'repaired.wav')
    const result = await renderDeclickRepaired(src, out, 'standard')
    expect(result?.path).toBe(out)
    const raw = execFileSync(FF, ['-v', 'error', '-i', out, '-f', 'f32le', '-'], {
      maxBuffer: 1024 * 1024 * 64,
    })
    const s = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4)
    let peak = 0
    let loud = 0
    for (let i = 0; i < s.length; i++) {
      const a = Math.abs(s[i])
      if (a > peak) peak = a
      if (a > 0.15) loud++
    }
    // The 0.9 impulses are gone (the 0.25 sine is the peak again)...
    expect(peak).toBeLessThan(0.3)
    // ...and the sine itself survived: a render that silenced everything would pass the
    // assertion above while being useless to listen to.
    expect(loud / s.length).toBeGreaterThan(0.5)
  }, 60000)

  it('renders the whole track, not an excerpt', async () => {
    // The 4 s fixture must come back 4 s long: a windowed render would leave most of the
    // click marks pointing at audio the preview never produced.
    const out = join(dir, 'whole.wav')
    await renderDeclickRepaired(src, out, 'standard')
    const raw = execFileSync(
      FF,
      ['-v', 'error', '-i', out, '-f', 'f32le', '-ar', '44100', '-ac', '1', '-'],
      { maxBuffer: 1024 * 1024 * 64 },
    )
    expect(raw.length / 4 / 44100).toBeCloseTo(4, 1)
  }, 60000)

  it('reports progress as it goes, so the wait is not a blind spinner', async () => {
    const seen: number[] = []
    await renderDeclickRepaired(src, join(dir, 'progress.wav'), 'standard', (d) => seen.push(d))
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.at(-1)).toBe(1)
    expect(seen.every((d) => d >= 0 && d <= 1)).toBe(true)
  }, 60000)

  it('resolves null when cancelled, rather than failing', async () => {
    // A preset change kills the render mid-write. That is the expected end of a
    // superseded render, not an error the UI should surface.
    const pending = renderDeclickRepaired(src, join(dir, 'killed.wav'), 'strong', undefined, (c) =>
      setTimeout(() => c.kill('SIGKILL'), 10),
    )
    expect(await pending).toBeNull()
  }, 60000)

  it('renders nothing when the mode is off', async () => {
    expect(await renderDeclickRepaired(src, join(dir, 'no.wav'), 'off')).toBeNull()
  }, 30000)
})

// The repair section's detector, through the real decode: the fixture carries one click
// every half second, and the detector must find events, not samples.
describe('detectTrackClicks', () => {
  it('counts the fixture’s clicks exactly', async () => {
    expect((await detectTrackClicks(src)).count).toBe(8)
  }, 30000)

  // Through the real decode, not just synthetic arrays: the marks are what the wave
  // draws and what "jump to the next click" seeks to, so a mark that lands anywhere
  // but on its click makes both features lie.
  it('marks each click where it actually sits', async () => {
    // The fixture's impulses land on every half-second boundary from t=0 (aevalsrc's
    // mod(t,0.5) fires at zero), so the marks must read 0, 0.5, 1.0 … 3.5.
    const { marks } = await detectTrackClicks(src)
    expect(marks).toHaveLength(8)
    for (let i = 0; i < marks.length; i++) expect(marks[i]).toBeCloseTo(i * 0.5, 2)
  }, 30000)

  it('reports how far it scanned, so the wave can say where the analysis ends', async () => {
    expect((await detectTrackClicks(src)).scannedSec).toBeGreaterThan(0)
  }, 30000)
})
