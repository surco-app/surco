// Serato's beatgrid tag, built from scratch for converted outputs. The format
// is the community-documented one (Holzhaus/serato-tags), byte-identical across
// the independent implementations (Mixxx, triseratops, serato-tools): a version
// word, a marker count, non-terminal markers (position + beats-to-next) and one
// terminal marker (position + BPM), then a footer byte. A constant grid is a
// single terminal marker; a multi-segment grid writes each leading segment as a
// non-terminal marker whose whole-beat count to the next marker is how Serato
// re-derives that span's tempo from the positions themselves.
import { gridSegments } from '../shared/beatgrid'
import type { Beatgrid } from '../shared/types'

export const SERATO_BEATGRID_DESC = 'Serato BeatGrid'
export const SERATO_BEATGRID_MIME = 'application/octet-stream'

export function seratoBeatgridPayload(grid: Beatgrid): Uint8Array {
  const segments = gridSegments(grid)
  const buf = Buffer.alloc(6 + segments.length * 8 + 1)
  // Version 0x0100 — readers hard-reject anything else.
  buf.writeUInt8(0x01, 0)
  buf.writeUInt8(0x00, 1)
  buf.writeUInt32BE(segments.length, 2)
  let offset = 6
  for (let i = 0; i < segments.length - 1; i++) {
    buf.writeFloatBE(segments[i].anchorSec, offset)
    // Whole beats to the next marker — the format allows nothing fractional,
    // the same rounding Serato itself applies when a marker is dragged.
    const beats = Math.max(
      1,
      Math.round(((segments[i + 1].anchorSec - segments[i].anchorSec) * segments[i].bpm) / 60),
    )
    buf.writeUInt32BE(beats, offset + 4)
    offset += 8
  }
  const last = segments[segments.length - 1]
  buf.writeFloatBE(last.anchorSec, offset)
  buf.writeFloatBE(last.bpm, offset + 4)
  // Serato writes a random footer byte and never reads it back; Mixxx writes 0.
  buf.writeUInt8(0x00, offset + 8)
  return new Uint8Array(buf)
}

// The FLAC form: a SERATO_BEATGRID vorbis comment holding the GEOB content in
// Serato's base64 envelope — MIME + double NUL + tag name + NUL + payload,
// encoded with no padding, a newline every 72 chars, and the dangling extra
// 'A' Serato's own encoder leaves behind (Mixxx reproduces it; readers strip it).
export function seratoBeatgridVorbis(grid: Beatgrid): string {
  const envelope = Buffer.concat([
    Buffer.from(SERATO_BEATGRID_MIME, 'latin1'),
    Buffer.from([0, 0]),
    Buffer.from(SERATO_BEATGRID_DESC, 'latin1'),
    Buffer.from([0]),
    seratoBeatgridPayload(grid),
  ])
  const encoded = envelope.toString('base64').replace(/=+$/, '')
  const lines: string[] = []
  for (let i = 0; i < encoded.length; i += 72) lines.push(encoded.slice(i, i + 72))
  return `${lines.join('\n')}A`
}
