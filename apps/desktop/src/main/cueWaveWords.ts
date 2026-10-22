import { type ChildProcess, spawn } from 'node:child_process'
import { constants as osConstants, setPriority } from 'node:os'
import { forcedInputArgs } from '../shared/inputFormat'

const WORDS_PER_SECOND = 150
const CHANNELS = 4
const TOP_HEIGHT = 31
const TOP_COLOUR = 7
const HEIGHT_GAIN = 1.1
const HEIGHT_POWER = 2
const COLOUR_POWER = 0.375

export function createCueWaveWords(sampleRate: number): {
  push: (chunk: Float32Array) => void
  finish: () => Uint16Array
} {
  const words: number[] = []
  const energy = [0, 0, 0]
  let peak = 0
  let channel = 0
  let frames = 0
  let inWord = 0
  let end = Math.floor(sampleRate / WORDS_PER_SECOND)

  function close(): void {
    const height = Math.round(TOP_HEIGHT * Math.min(1, peak * HEIGHT_GAIN) ** HEIGHT_POWER)
    const levels = energy.map((e) => e ** COLOUR_POWER)
    const top = Math.max(...levels)
    const [low, mid, high] = levels.map((v) => (top > 0 ? Math.round((TOP_COLOUR * v) / top) : 0))
    words.push((low << 13) | (mid << 10) | (high << 7) | (height << 2))
    peak = 0
    energy.fill(0)
    inWord = 0
    end = Math.floor(((words.length + 1) * sampleRate) / WORDS_PER_SECOND)
  }

  return {
    push(chunk: Float32Array): void {
      for (let i = 0; i < chunk.length; i++) {
        const v = chunk[i]
        if (channel === 0) {
          const a = v < 0 ? -v : v
          if (a > peak) peak = a
        } else energy[channel - 1] += v * v
        if (++channel === CHANNELS) {
          channel = 0
          frames++
          inWord++
          if (frames >= end) close()
        }
      }
    },
    finish(): Uint16Array {
      if (inWord > 0) close()
      return Uint16Array.from(words)
    },
  }
}

const MONO = 'aformat=sample_fmts=flt:channel_layouts=mono'
const LOW_EDGE = 150
const HIGH_EDGE = 400
const BANDS =
  `[0:a:0]aformat=channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1,asplit=4[a][b][c][d];` +
  `[a]${MONO}[full];` +
  `[b]lowpass=f=${LOW_EDGE},lowpass=f=${LOW_EDGE},${MONO}[low];` +
  `[c]highpass=f=${LOW_EDGE},highpass=f=${LOW_EDGE},lowpass=f=${HIGH_EDGE},lowpass=f=${HIGH_EDGE},${MONO}[mid];` +
  `[d]highpass=f=${HIGH_EDGE},highpass=f=${HIGH_EDGE},${MONO}[high];` +
  `[full][low][mid][high]amerge=inputs=4[out]`

const running = new Set<ChildProcess>()

export function killCueWaveWords(): void {
  for (const child of running) child.kill('SIGTERM')
  running.clear()
}

export function runCueWaveWords(
  input: string,
  ffmpegPath: string,
  sampleRate: number,
  timeoutMs: number,
): Promise<Uint16Array> {
  const words = createCueWaveWords(sampleRate)
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
        '-filter_complex',
        BANDS,
        '-map',
        '[out]',
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
      words.push(new Float32Array(aligned.buffer))
    })
    child.on('error', (err) => {
      running.delete(child)
      reject(err)
    })
    child.on('close', (code) => {
      running.delete(child)
      if (code === 0) resolve(words.finish())
      else reject(new Error(`cue wave words exited with code ${code}`))
    })
  })
}
