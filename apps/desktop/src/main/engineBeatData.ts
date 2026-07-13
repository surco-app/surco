// Engine DJ's beatData blob, built for the staged grid. The layout is
// libdjinterop's (the reference implementation Mixxx exports through), verified
// against the Mixxx wiki's independent reverse-engineering: a qCompress-style
// envelope (uncompressed length uint32 BE + zlib stream) around a big-endian
// header and two grids — default and adjusted, identical for a fresh import —
// whose marker structs are little-endian. Engine 4.x moves the column to its
// own PerformanceData table but keeps this exact byte format.
import { deflateSync } from 'node:zlib'
import { gridSegments } from '../shared/beatgrid'
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
  const segments = gridSegments(grid)
  // Engine's convention: the first marker sits at beat -4 (before the track
  // starts, offset usually negative) and the last at the first beat at/after
  // the end — at least one beat apart, or the grid is rejected as degenerate.
  // Every grid change in between is its own marker: beat indexes accumulate
  // whole beats per span, and a span's offset delta over its beat count is
  // what Engine reads as that span's tempo.
  const base = segments[0]
  const baseSamplesPerBeat = (sampleRateHz * 60) / base.bpm
  const markers: Marker[] = [
    {
      sampleOffset: base.anchorSec * sampleRateHz - 4 * baseSamplesPerBeat,
      beatIndex: -4,
      beatsToNext: 4,
    },
  ]
  let beatIndex = 0
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1]
    const beats = Math.max(
      1,
      Math.round(((segments[i].anchorSec - prev.anchorSec) * prev.bpm) / 60),
    )
    markers[markers.length - 1].beatsToNext += beats
    beatIndex += beats
    markers.push({
      sampleOffset: segments[i].anchorSec * sampleRateHz,
      beatIndex,
      beatsToNext: 0,
    })
  }
  const lastSeg = segments[segments.length - 1]
  const lastSamplesPerBeat = (sampleRateHz * 60) / lastSeg.bpm
  const beatsToEnd = Math.max(
    1,
    Math.ceil((sampleCount - lastSeg.anchorSec * sampleRateHz) / lastSamplesPerBeat),
  )
  markers[markers.length - 1].beatsToNext += beatsToEnd
  markers.push({
    sampleOffset: lastSeg.anchorSec * sampleRateHz + beatsToEnd * lastSamplesPerBeat,
    beatIndex: beatIndex + beatsToEnd,
    beatsToNext: 0,
  })

  const gridBytes = 8 + markers.length * 24
  const raw = Buffer.alloc(17 + 2 * gridBytes)
  raw.writeDoubleBE(sampleRateHz, 0)
  raw.writeDoubleBE(sampleCount, 8)
  raw.writeUInt8(1, 16)
  let offset = 17
  for (let copy = 0; copy < 2; copy++) {
    raw.writeBigInt64BE(BigInt(markers.length), offset)
    offset += 8
    for (const marker of markers) {
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
