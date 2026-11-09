import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it } from 'vitest'
import { CUE_WAVE_FINE_PER_SECOND, createCueWaveFine, runCueWaveFine } from './cueWaveFine'

const FF = ffmpegStatic as unknown as string
const RATE = 48000

function reduce(...chunks: Float32Array[]): Uint8Array {
  const fine = createCueWaveFine(RATE)
  for (const chunk of chunks) fine.push(chunk)
  return fine.finish()
}

const steady = (count: number, value: number) => new Float32Array(count).fill(value)

describe('createCueWaveFine', () => {
  // rekordbox keeps 150 levels a second, so one bar zoomed across the editor showed steps
  // tens of pixels wide. A thousand a second gives about one level per pixel at the deepest zoom.
  it('writes a thousand levels a second', () => {
    expect(reduce(steady(RATE, 0.5))).toHaveLength(CUE_WAVE_FINE_PER_SECOND)
  })

  it('keeps the last part of a window at the end of the track', () => {
    expect(reduce(steady(RATE + 10, 0.5))).toHaveLength(CUE_WAVE_FINE_PER_SECOND + 1)
  })

  // The height follows the same curve as rekordbox's wave, so swapping one for the other
  // changes how fine it is, not how tall the kicks look.
  it('reaches the top on a full-scale peak, stays at zero in silence and curves like rekordbox', () => {
    expect(reduce(steady(48, 1))[0]).toBe(255)
    expect(reduce(steady(48, 0))[0]).toBe(0)
    expect(reduce(steady(48, 0.5))[0]).toBe(Math.round(255 * (0.5 * 1.1) ** 2))
  })

  it('puts a click in the millisecond it happens, not in its neighbours', () => {
    const chunk = steady(RATE / 10, 0)
    chunk[(RATE / 1000) * 37 + 5] = -0.9
    const fine = reduce(chunk)
    expect(fine[37]).toBeGreaterThan(200)
    expect(fine[36]).toBe(0)
    expect(fine[38]).toBe(0)
  })

  it('reads a chunk split in the middle of a window like one piece', () => {
    const whole = steady(RATE / 10, 0.3)
    whole[1000] = 0.8
    expect([...reduce(whole.subarray(0, 1001), whole.subarray(1001))]).toEqual([...reduce(whole)])
  })
})

describe('runCueWaveFine', () => {
  it('decodes a real file to the levels of its loud and quiet halves', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-fine-'))
    const file = join(dir, 'half.wav')
    execFileSync(FF, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'aevalsrc=if(lt(t\\,0.5)\\,0.8*sin(2*PI*2000*t)\\,0):s=44100:d=1',
      '-y',
      file,
    ])
    const fine = await runCueWaveFine(file, FF, 44100, 1, 30000)
    expect(fine.length).toBe(1000)
    expect(Math.min(...fine.subarray(50, 450))).toBeGreaterThan(180)
    expect(Math.max(...fine.subarray(550, 950))).toBe(0)
  })

  it('averages the two sides of a stereo file into the same height a mono one gets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-fine-'))
    const file = join(dir, 'stereo.wav')
    execFileSync(FF, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'aevalsrc=0.8*sin(2*PI*2000*t)|0.8*sin(2*PI*2000*t):s=44100:d=0.2',
      '-y',
      file,
    ])
    const fine = await runCueWaveFine(file, FF, 44100, 2, 30000)
    expect(Math.min(...fine.subarray(10, 190))).toBeGreaterThan(180)
  })
})
