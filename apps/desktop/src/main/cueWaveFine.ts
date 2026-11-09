import { type ChildProcess, spawn } from 'node:child_process'
import { constants as osConstants, setPriority } from 'node:os'
import { forcedInputArgs } from '../shared/inputFormat'

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
    const child = spawn(
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
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: timeoutMs },
    )
    if (child.pid !== undefined) {
      try {
        setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
      } catch {}
    }
    running.add(child)
    let tail = Buffer.alloc(0)
    child.stdout.on('data', (chunk: Buffer) => {
      const data = tail.length > 0 ? Buffer.concat([tail, chunk]) : chunk
      const usable = data.length - (data.length % 4)
      tail = Buffer.from(data.subarray(usable))
      if (usable === 0) return
      const aligned = new Uint8Array(usable)
      aligned.set(data.subarray(0, usable))
      fine.push(new Float32Array(aligned.buffer))
    })
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
