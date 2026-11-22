import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))
vi.mock('./worker', async (importOriginal) => {
  const original = await importOriginal<typeof import('./worker')>()
  const { runWorkerJob } = await import('./workerJobs')
  return { ...original, runInWorker: vi.fn(async (job) => runWorkerJob(job)) }
})

import { isAbortError } from './analysisCancel'
import { measureReplaceShift } from './ffmpeg'
import { runInWorker } from './worker'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-replace-shift-'))

function music(path: string, seconds: number): void {
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `anoisesrc=color=pink:seed=11:d=${seconds}:r=44100:a=0.3`,
    '-f',
    'lavfi',
    '-i',
    `aevalsrc='if(lt(mod(t,0.437),0.002),0.8,0)':s=44100:d=${seconds}`,
    '-filter_complex',
    'amix=inputs=2:normalize=0',
    path,
  ])
}

function derive(from: string, to: string, args: string[]): void {
  execFileSync(FF, ['-y', '-v', 'error', '-i', from, ...args, to])
}

// The cues a DJ placed on the old file only stay on the beat if the new master's shift is measured,
// so these run the real ffmpeg decode and the real correlation on synthetic masters.
describe('measureReplaceShift', () => {
  const old = join(dir, 'old.flac')
  const lead = join(dir, 'lead.flac')
  const mp3 = join(dir, 'new.mp3')
  const short = join(dir, 'short.flac')
  beforeAll(() => {
    music(old, 90)
    derive(old, lead, ['-af', 'adelay=1500:all=1'])
    derive(old, mp3, ['-b:a', '320k'])
    music(short, 40)
  })

  // A master with 1.5 s more lead-in sounds every beat 1.5 s later: if the measure misses it the
  // DJ's cues land a second and a half before their beat.
  it('measures a master with 1.5 s more lead-in as moved 1500 ms', async () => {
    const result = await measureReplaceShift(old, lead)
    expect(result).toHaveProperty('moved')
    expect(Math.abs((result as { moved: number }).moved - 1500)).toBeLessThanOrEqual(1)
  })

  // The same audio re-encoded must not move the cues: each DJ program adds its own codec lead
  // separately, so here only the audio counts and a phantom shift would knock every cue off.
  it('measures the same audio re-encoded as LAME MP3 as not moved', async () => {
    const result = await measureReplaceShift(old, mp3)
    expect(result).toHaveProperty('moved')
    expect(Math.abs((result as { moved: number }).moved)).toBeLessThanOrEqual(1)
  })

  // A missing old file cannot be measured; the conversion goes on without moving anything.
  it('says unreadable when the old file is gone', async () => {
    expect(await measureReplaceShift(join(dir, 'gone.flac'), lead)).toEqual({
      unmoved: 'unreadable',
    })
  })

  it('says unreadable when the old file is not audio', async () => {
    const text = join(dir, 'text.mp3')
    writeFileSync(text, 'not audio at all')
    expect(await measureReplaceShift(text, lead)).toEqual({ unmoved: 'unreadable' })
  })

  // With under two windows apart there is no tail to confirm the head, and one window alone cannot
  // rule out an edit further in, so the cues stay put.
  it('says noMatch for a track too short for two windows', async () => {
    expect(await measureReplaceShift(short, short)).toEqual({ unmoved: 'noMatch' })
  })

  // Surco instantaneo: a 2^21-point FFT on the main process takes over 100 ms and freezes IPC and
  // the audition stream, so the correlation must be handed to the worker.
  it('hands the correlation to the worker, not the main process', async () => {
    await measureReplaceShift(old, lead)
    expect(runInWorker).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'replaceShift' }),
      expect.any(Array),
    )
  })

  // Cancelling a batch must stop the work, not report the track as unreadable.
  it('rethrows a cancel', async () => {
    const ctl = new AbortController()
    ctl.abort()
    const err = await measureReplaceShift(old, lead, ctl.signal).catch((e) => e)
    expect(isAbortError(err)).toBe(true)
  })
})
