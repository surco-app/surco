// Engine DJ's beatData blob, built for the staged constant grid. The layout is
// libdjinterop's (the reference implementation Mixxx exports through), verified
// against the Mixxx wiki's independent reverse-engineering: a qCompress-style
// envelope (uncompressed length uint32 BE + zlib stream) around a big-endian
// header and two grids — default and adjusted, identical for a fresh import —
// whose marker structs are little-endian. Engine 4.x moves the column to its
// own PerformanceData table but keeps this exact byte format.
import { deflateSync } from 'node:zlib'
import type { Beatgrid } from '../shared/types'

interface Marker {
  sampleOffset: number
  beatIndex: number
  beatsToNext: number
}

export function engineBeatData(
  grid: Beatgrid,
  sampleRateHz: number,
  sampleCount: number,
): Uint8Array {
  const samplesPerBeat = (sampleRateHz * 60) / grid.bpm
  const firstBeatSample = grid.anchorSec * sampleRateHz
  // Engine's convention: the first marker sits at beat -4 (before the track
  // starts, offset usually negative) and the last at the first beat at/after
  // the end — at least one beat apart, or the grid is rejected as degenerate.
  const lastIndex = Math.max(1, Math.ceil((sampleCount - firstBeatSample) / samplesPerBeat))
  const first: Marker = {
    sampleOffset: firstBeatSample - 4 * samplesPerBeat,
    beatIndex: -4,
    beatsToNext: lastIndex + 4,
  }
  const last: Marker = {
    sampleOffset: firstBeatSample + lastIndex * samplesPerBeat,
    beatIndex: lastIndex,
    beatsToNext: 0,
  }

  const GRID_BYTES = 8 + 2 * 24
  const raw = Buffer.alloc(17 + 2 * GRID_BYTES)
  raw.writeDoubleBE(sampleRateHz, 0)
  raw.writeDoubleBE(sampleCount, 8)
  raw.writeUInt8(1, 16)
  let offset = 17
  for (let copy = 0; copy < 2; copy++) {
    raw.writeBigInt64BE(2n, offset)
    offset += 8
    for (const marker of [first, last]) {
      raw.writeDoubleLE(marker.sampleOffset, offset)
      raw.writeBigInt64LE(BigInt(marker.beatIndex), offset + 8)
      raw.writeInt32LE(marker.beatsToNext, offset + 16)
      // The trailing int is unknown even to libdjinterop; every known-good
      // writer sets 0 and Engine accepts it.
      raw.writeInt32LE(0, offset + 20)
      offset += 24
    }
  }

  const length = Buffer.alloc(4)
  length.writeUInt32BE(raw.length, 0)
  return new Uint8Array(Buffer.concat([length, deflateSync(raw)]))
}
