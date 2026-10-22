import { describe, expect, it } from 'vitest'
import { createCueWaveWords } from './cueWaveWords'

const RATE = 48000
const PER_WORD = RATE / 150

const height = (w: number) => (w >> 2) & 31
const low = (w: number) => (w >> 13) & 7
const mid = (w: number) => (w >> 10) & 7
const high = (w: number) => (w >> 7) & 7

function frames(count: number, frame: [number, number, number, number]): Float32Array {
  const out = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) out.set(frame, i * 4)
  return out
}

function reduce(...chunks: Float32Array[]): Uint16Array {
  const words = createCueWaveWords(RATE)
  for (const chunk of chunks) words.push(chunk)
  return words.finish()
}

describe('createCueWaveWords', () => {
  it('writes 150 words a second, the rate of the rekordbox wave the drop model was trained on, so a bar spans the same words', () => {
    expect(reduce(frames(RATE, [0.5, 0.1, 0.1, 0.1]))).toHaveLength(150)
  })

  it('keeps the last part of a word at the end of the track, so a drop in the closing bar is still heard', () => {
    expect(reduce(frames(RATE + 10, [0.5, 0.1, 0.1, 0.1]))).toHaveLength(151)
  })

  it('reaches the top height on a full-scale peak and stays at zero in silence', () => {
    const words = reduce(frames(PER_WORD, [1, 0.5, 0.5, 0.5]), frames(PER_WORD, [0, 0, 0, 0]))
    expect(height(words[0])).toBe(31)
    expect(words[1]).toBe(0)
  })

  it('grows the height with the square of the peak, as rekordbox draws it, measured against its own waves', () => {
    const words = reduce(
      frames(PER_WORD, [0.25, 0.1, 0, 0]),
      frames(PER_WORD, [0.5, 0.1, 0, 0]),
      frames(PER_WORD, [0.75, 0.1, 0, 0]),
    )
    expect([...words].map(height)).toEqual([2, 9, 21])
  })

  it('reads the height from the loudest sample in the word, so a kick inside a quiet word still counts', () => {
    const word = frames(PER_WORD, [0.05, 0.01, 0, 0])
    word[100 * 4] = -1
    expect(height(reduce(word)[0])).toBe(31)
  })

  it('gives the loudest band full colour and scales the others to it, as rekordbox colours its wave', () => {
    const [bass, both] = reduce(
      frames(PER_WORD, [0.8, 0.6, 0, 0]),
      frames(PER_WORD, [0.8, 0.4, 0, 0.4]),
    )
    expect([low(bass), mid(bass), high(bass)]).toEqual([7, 0, 0])
    expect([low(both), mid(both), high(both)]).toEqual([7, 0, 7])
  })

  it('reads a word torn across two pushes the same as in one, since the decode arrives in arbitrary chunks', () => {
    const whole = frames(PER_WORD * 3, [0.6, 0.5, 0.2, 0.1])
    whole[5 * 4] = 0.9
    expect(reduce(whole.subarray(0, 333), whole.subarray(333))).toEqual(reduce(whole))
  })
})
