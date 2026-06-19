import { describe, expect, it } from 'vitest'
import { detectKey } from './musicalKey'

// Same rate ffmpeg decodes to for analysis (see tempo.ts) — the tests synthesize
// at the production rate so they exercise exactly what the detector receives.
const SR = 11025

// Equal-temperament frequency for a pitch class (0 = C) at a given octave.
function pitchHz(pc: number, octave: number): number {
  const midi = 12 * (octave + 1) + pc
  return 440 * 2 ** ((midi - 69) / 12)
}

// A chord progression rendered as summed sines, one second per chord, each
// chord a triad given as pitch classes. Sines are the worst case for timbre
// (no harmonics reinforcing the root), so a detector that nails these has the
// chroma mapping right, not a lucky overtone.
function progression(chords: number[][], secondsPerChord = 1, repeats = 4): Float32Array {
  const chordLen = Math.floor(SR * secondsPerChord)
  const samples = new Float32Array(chordLen * chords.length * repeats)
  let offset = 0
  for (let r = 0; r < repeats; r++) {
    for (const chord of chords) {
      for (let i = 0; i < chordLen; i++) {
        let v = 0
        for (const pc of chord) v += Math.sin((2 * Math.PI * pitchHz(pc, 4) * i) / SR)
        samples[offset + i] = v / chord.length
      }
      offset += chordLen
    }
  }
  return samples
}

// Deterministic white noise (LCG): energy in every bin, tonality in none.
function noise(seconds: number): Float32Array {
  const samples = new Float32Array(Math.floor(SR * seconds))
  let state = 1
  for (let i = 0; i < samples.length; i++) {
    state = (state * 48271) % 2147483647
    samples[i] = state / 2147483647 - 0.5
  }
  return samples
}

// Pitch classes: C=0 D=2 E=4 F=5 G=7 A=9 B=11.
const C = 0
const D = 2
const E = 4
const F = 5
const FS = 6
const G = 7
const A = 9
const B = 11

describe('detectKey', () => {
  it('names a I-IV-V progression in C major and its Camelot code', () => {
    // C–F–G–C covers the full major scale with the tonic emphasized — the
    // clearest possible statement of C major. 8B is what a DJ sorting by
    // Camelot expects to read for it.
    const result = detectKey(
      progression([
        [C, E, G],
        [F, A, C],
        [G, B, D],
        [C, E, G],
      ]),
      SR,
    )
    expect(result?.name).toBe('C')
    expect(result?.camelot).toBe('8B')
  })

  it('distinguishes the relative minor from its major', () => {
    // A minor shares every note with C major; only the tonal centre differs.
    // An i–iv–v progression around A must read as Am (8A), not C — this is
    // the discrimination the major/minor profile pair exists for.
    const result = detectKey(
      progression([
        [A, C, E],
        [D, F, A],
        [E, G, B],
        [A, C, E],
      ]),
      SR,
    )
    expect(result?.name).toBe('Am')
    expect(result?.camelot).toBe('8A')
  })

  it('follows a transposition', () => {
    // The same I-IV-V shape rooted on G must read G major (9B): the detector
    // must rotate with the music, not favour any absolute pitch class.
    const gMajor = [
      [G, B, D],
      [C, E, G],
      [D, FS, A],
      [G, B, D],
    ]
    const result = detectKey(progression(gMajor), SR)
    expect(result?.name).toBe('G')
    expect(result?.camelot).toBe('9B')
  })

  it('returns null for silence instead of inventing a key', () => {
    expect(detectKey(new Float32Array(SR * 16), SR)).toBeNull()
  })

  it('returns null for unpitched noise instead of a spurious key', () => {
    // Percussion-only or textural material has no tonality; a wrong key
    // silently trusted ruins a harmonic mix, so "no suggestion" must win
    // over a confident-looking guess.
    expect(detectKey(noise(16), SR)).toBeNull()
  })

  it('returns null when the audio is too short to average a stable chroma', () => {
    expect(detectKey(progression([[C, E, G]], 0.1, 1), SR)).toBeNull()
  })

  it('reports a clear progression with high confidence', () => {
    const result = detectKey(
      progression([
        [C, E, G],
        [F, A, C],
        [G, B, D],
        [C, E, G],
      ]),
      SR,
    )
    expect(result?.confidence).toBeGreaterThan(0.5)
  })
})
