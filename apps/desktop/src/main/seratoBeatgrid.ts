// Serato's beatgrid tag, built from scratch for converted outputs. The format
// is the community-documented one (Holzhaus/serato-tags), byte-identical across
// the independent implementations (Mixxx, triseratops, serato-tools): a version
// word, a marker count, non-terminal markers (position + beats-to-next) and one
// terminal marker (position + BPM), then a footer byte. Surco stages constant
// grids only, which Serato expresses as a single terminal marker.
import type { Beatgrid } from '../shared/types'

export const SERATO_BEATGRID_DESC = 'Serato BeatGrid'
export const SERATO_BEATGRID_MIME = 'application/octet-stream'

export function seratoBeatgridPayload(grid: Beatgrid): Uint8Array {
  const buf = Buffer.alloc(15)
  // Version 0x0100 — readers hard-reject anything else.
  buf.writeUInt8(0x01, 0)
  buf.writeUInt8(0x00, 1)
  buf.writeUInt32BE(1, 2)
  buf.writeFloatBE(grid.anchorSec, 6)
  buf.writeFloatBE(grid.bpm, 10)
  // Serato writes a random footer byte and never reads it back; Mixxx writes 0.
  buf.writeUInt8(0x00, 14)
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
