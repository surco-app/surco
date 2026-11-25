import type { ChildProcess } from 'node:child_process'
import { forcedInputArgs } from '../shared/inputFormat'
import { f32Chunks, spawnBackgroundDecode } from './ffmpegStream'

export const CUE_WAVE_FINE_PER_SECOND = 1000
const TOP = 255
const HEIGHT_GAIN = 1.1
const HEIGHT_POWER = 2

export function createCueWaveFine(sampleRate: number): {
  push: (chunk: Float32Array) => void
  finish: () => Uint8Array
} {
  const levels: number[] = []
  let peak = 0
  let frames = 0
  let inWindow = 0
  let end = Math.floor(sampleRate / CUE_WAVE_FINE_PER_SECOND)

  function close(): void {
    levels.push(Math.round(TOP * Math.min(1, peak * HEIGHT_GAIN) ** HEIGHT_POWER))
    peak = 0
    inWindow = 0
    end = Math.floor(((levels.length + 1) * sampleRate) / CUE_WAVE_FINE_PER_SECOND)
  }

  return {
    push(chunk: Float32Array): void {
      for (let i = 0; i < chunk.length; i++) {
        const v = chunk[i]
        const a = v < 0 ? -v : v
        if (a > peak) peak = a
        frames++
        inWindow++
        if (frames >= end) close()
      }
    },
    finish(): Uint8Array {
      if (inWindow > 0) close()
      return Uint8Array.from(levels)
    },
  }
}

const DOWNMIX = 'pan=mono|c0=0.5*c0+0.5*c1,'

const running = new Set<ChildProcess>()

export function killCueWaveFine(): void {
  for (const child of running) child.kill('SIGTERM')
  running.clear()
}

export function runCueWaveFine(
  input: string,
  ffmpegPath: string,
  sampleRate: number,
  channels: number,
  timeoutMs: number,
): Promise<Uint8Array> {
  const fine = createCueWaveFine(sampleRate)
  return new Promise((resolve, reject) => {
    const child = spawnBackgroundDecode(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        ...forcedInputArgs(input),
        '-i',
        input,
        '-map',
        '0:a:0',
        '-af',
        `${channels > 1 ? DOWNMIX : ''}aformat=sample_fmts=flt:channel_layouts=mono`,
        '-f',
        'f32le',
        '-',
      ],
      timeoutMs,
    )
    running.add(child)
    child.stdout.on(
      'data',
      f32Chunks((floats) => fine.push(floats)),
    )
    child.on('error', (err) => {
      running.delete(child)
      reject(err)
    })
    child.on('close', (code) => {
      running.delete(child)
      if (code === 0) resolve(fine.finish())
      else reject(new Error(`cue wave fine exited with code ${code}`))
    })
  })
}
