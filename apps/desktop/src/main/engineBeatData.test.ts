import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { engineBeatData } from './engineBeatData'

// 30 s at 44.1 kHz, 120 BPM anchored 0.25 s in: one beat = 22050 samples, the
// first beat at sample 11025, and 60 whole beats reach past the track end.
const grid = { bpm: 120, anchorSec: 0.25 }
const RATE = 44100
const SAMPLES = 1323000

function decompressed(): Buffer {
  const blob = Buffer.from(engineBeatData(grid, RATE, SAMPLES))
  // qCompress envelope: uncompressed length uint32 BE, then a zlib stream.
  const raw = inflateSync(blob.subarray(4))
  expect(blob.readUInt32BE(0)).toBe(raw.length)
  return raw
}

describe('engineBeatData', () => {
  // The header libdjinterop (and Engine) reads: sample rate and length as
  // big-endian doubles, then the grid-set flag.
  it('writes the header fields big-endian', () => {
    const raw = decompressed()
    expect(raw.readDoubleBE(0)).toBe(RATE)
    expect(raw.readDoubleBE(8)).toBe(SAMPLES)
    expect(raw.readUInt8(16)).toBe(1)
  })

  // Engine's convention (libdjinterop, Mixxx's export): a constant grid is two
  // markers — beat -4 before the start and the first beat at/after the end —
  // with the marker fields little-endian inside the big-endian envelope.
  it('lays the two-marker constant grid out with the documented endianness', () => {
    const raw = decompressed()
    expect(raw.readBigInt64BE(17)).toBe(2n)
    const m1 = 25
    expect(raw.readDoubleLE(m1)).toBe(11025 - 4 * 22050)
    expect(raw.readBigInt64LE(m1 + 8)).toBe(-4n)
    expect(raw.readInt32LE(m1 + 16)).toBe(64)
    expect(raw.readInt32LE(m1 + 20)).toBe(0)
    const m2 = m1 + 24
    expect(raw.readDoubleLE(m2)).toBe(11025 + 60 * 22050)
    expect(raw.readDoubleLE(m2)).toBeGreaterThanOrEqual(SAMPLES)
    expect(raw.readBigInt64LE(m2 + 8)).toBe(60n)
    expect(raw.readInt32LE(m2 + 16)).toBe(0)
    expect(raw.readInt32LE(m2 + 20)).toBe(0)
  })

  // Engine edits land on the "adjusted" grid and readers prefer it; known-good
  // writers store the same grid twice, so both must be byte-identical.
  it('writes identical default and adjusted grids', () => {
    const raw = decompressed()
    const gridBytes = 8 + 2 * 24
    const first = raw.subarray(17, 17 + gridBytes)
    const second = raw.subarray(17 + gridBytes, 17 + 2 * gridBytes)
    expect(second.equals(first)).toBe(true)
    expect(raw.length).toBe(17 + 2 * gridBytes)
  })

  // A grid whose anchor sits past the end of a short clip still needs its two
  // markers ordered first-before-last or Engine rejects the blob.
  it('keeps at least one beat between the markers on degenerate clips', () => {
    const blob = Buffer.from(engineBeatData({ bpm: 120, anchorSec: 10 }, RATE, RATE))
    const raw = inflateSync(blob.subarray(4))
    const firstOffset = raw.readDoubleLE(25)
    const lastOffset = raw.readDoubleLE(25 + 24)
    expect(lastOffset).toBeGreaterThan(firstOffset)
    expect(raw.readInt32LE(25 + 16)).toBeGreaterThan(0)
  })
})
