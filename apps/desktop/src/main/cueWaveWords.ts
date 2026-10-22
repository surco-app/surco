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
