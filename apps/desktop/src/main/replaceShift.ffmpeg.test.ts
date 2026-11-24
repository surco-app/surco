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

// Pink noise is the same loudness end to end, so its envelope has nothing to line up: the sections
// (each seed its own lengths and levels, like a different arrangement) give the contour another
// master keeps, and the hits give it onsets.
function structuredMusic(path: string, seconds: number, seed: number): void {
  let state = seed
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
  const sections: string[] = []
  for (let t = 0; t < seconds; ) {
    t += 3 + Math.round(next() * 14)
    sections.push(`lt(t,${t}),${(0.15 + next() * 0.85).toFixed(2)}`)
  }
  const volume = `${sections.map((s) => `if(${s},`).join('')}1${')'.repeat(sections.length)}`
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `anoisesrc=color=pink:seed=${seed}:d=${seconds}:r=44100:a=0.3`,
    '-f',
    'lavfi',
    '-i',
    `aevalsrc='if(lt(mod(t,0.469),0.002),0.8,0)':s=44100:d=${seconds}`,
    '-filter_complex',
    `amix=inputs=2:normalize=0,volume='${volume}':eval=frame`,
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
  const structured = join(dir, 'structured.flac')
  const otherMaster = join(dir, 'other-master.mp3')
  const otherTrack = join(dir, 'other-track.flac')
  const edit = join(dir, 'edit.flac')
  beforeAll(() => {
    music(old, 200)
    derive(old, lead, ['-af', 'adelay=1500:all=1'])
    derive(old, mp3, ['-b:a', '320k'])
    music(short, 40)
    structuredMusic(structured, 200, 7)
    derive(structured, otherMaster, [
      '-af',
      'adelay=300:all=1,lowpass=6000,asetrate=44100*1.0001,aresample=44100',
      '-b:a',
      '192k',
    ])
    structuredMusic(otherTrack, 200, 23)
    derive(structured, edit, [
      '-filter_complex',
      '[0]atrim=0:100[a];[0]atrim=start=100.02,asetpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=0:a=1',
    ])
  })

  const exactMeasureOfLastCall = async () => {
    const calls = vi.mocked(runInWorker).mock.calls
    const index = calls.findLastIndex(([job]) => job.type === 'replaceShift')
    return await vi.mocked(runInWorker).mock.results[index].value
  }

  // Another master (other lead-in, EQ and a clock a hair off) never lines up sample by sample, so
  // the exact measure gives up; without the envelope fallback every cue would sit 300 ms early.
  it('measures another master 300 ms later as moved 300 ms on another master', async () => {
    vi.mocked(runInWorker).mockClear()
    const result = await measureReplaceShift(structured, otherMaster)
    expect(await exactMeasureOfLastCall()).toEqual({ unmoved: 'noMatch' })
    expect(result).toMatchObject({ master: 'other' })
    expect(Math.abs((result as { moved: number }).moved - 300)).toBeLessThanOrEqual(10)
  })

  // A different track that only happens to replace this file must never move the cues: the
  // envelope of another arrangement fits nothing, and cues moved to noise are worse than unmoved.
  it('keeps a different track as noMatch', async () => {
    vi.mocked(runInWorker).mockClear()
    expect(await measureReplaceShift(structured, otherTrack)).toEqual({ unmoved: 'noMatch' })
    const calls = vi.mocked(runInWorker).mock.calls
    const envelope = calls.findIndex(([job]) => job.type === 'masterShift')
    expect(await vi.mocked(runInWorker).mock.results[envelope].value).toBeNull()
  })

  // An edit (20 ms cut out between head and tail) is not another master: the envelope would agree
  // within its 50 ms and move every cue by an average that is right nowhere, so drift stays.
  it('keeps an edit as drift without trying the envelope', async () => {
    expect(await measureReplaceShift(structured, edit)).toEqual({ unmoved: 'drift' })
  })

  // Surco instantaneo: the envelope search over six 30 s windows is too long for the main process.
  it('hands the envelope measure to the worker too', async () => {
    vi.mocked(runInWorker).mockClear()
    await measureReplaceShift(structured, otherMaster)
    expect(runInWorker).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'masterShift' }),
      expect.any(Array),
    )
  })

  // A master with 1.5 s more lead-in sounds every beat 1.5 s later: if the measure misses it the
  // DJ's cues land a second and a half before their beat.
  it('measures a master with 1.5 s more lead-in as moved 1500 ms', async () => {
    const result = await measureReplaceShift(old, lead)
    expect(result).toHaveProperty('moved')
    expect(result).not.toHaveProperty('master')
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

  // A replacement that cannot be read is not a cancel: a batch that took it for one would stop
  // converting every other track, so the cues just stay where they were.
  it('says noMatch when the new file is gone', async () => {
    expect(await measureReplaceShift(old, join(dir, 'gone.flac'))).toEqual({ unmoved: 'noMatch' })
  })

  it('says noMatch when the new file is not audio', async () => {
    const text = join(dir, 'text-new.mp3')
    writeFileSync(text, 'not audio at all')
    expect(await measureReplaceShift(old, text)).toEqual({ unmoved: 'noMatch' })
  })

  // With under two windows apart there is no tail to confirm the head, and one window alone cannot
  // rule out an edit further in, so the cues stay put.
  it('says noMatch for a track too short for two windows', async () => {
    expect(await measureReplaceShift(short, short)).toEqual({ unmoved: 'noMatch' })
  })

  // A track too short for the envelope's six windows can only come out unmoved there, so the two
  // whole-file decodes it needs would be time the batch spends for nothing.
  it('does not decode a track too short for six windows for the envelope measure', async () => {
    vi.mocked(runInWorker).mockClear()
    await measureReplaceShift(short, short)
    expect(runInWorker).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'masterShift' }),
      expect.anything(),
    )
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
