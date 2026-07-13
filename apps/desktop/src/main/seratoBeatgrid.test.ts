import { describe, expect, it } from 'vitest'
import { seratoBeatgridPayload, seratoBeatgridVorbis } from './seratoBeatgrid'

describe('seratoBeatgridPayload', () => {
  // The 15-byte constant-grid shape every reader (Serato, Mixxx, triseratops)
  // expects: version 0x0100, one marker — the terminal one — position + BPM as
  // big-endian float32, and a footer byte.
  it('lays out the constant grid byte for byte', () => {
    const bytes = Buffer.from(seratoBeatgridPayload({ bpm: 128, anchorSec: 0.052 }))
    expect(bytes).toHaveLength(15)
    expect(bytes.readUInt8(0)).toBe(0x01)
    expect(bytes.readUInt8(1)).toBe(0x00)
    expect(bytes.readUInt32BE(2)).toBe(1)
    expect(bytes.readFloatBE(6)).toBeCloseTo(0.052, 6)
    expect(bytes.readFloatBE(10)).toBe(128)
    expect(bytes.readUInt8(14)).toBe(0)
  })
})

describe('seratoBeatgridVorbis', () => {
  // The FLAC comment is the GEOB content wrapped in Serato's base64 envelope:
  // MIME + double NUL + tag name + NUL + payload, encoded without padding, a
  // newline every 72 chars, plus the dangling 'A' Serato's own encoder leaves
  // (Mixxx writes it too; readers strip it).
  it('encodes the enveloped payload the way Serato and Mixxx write it', () => {
    const text = seratoBeatgridVorbis({ bpm: 128, anchorSec: 0.052 })
    expect(text.endsWith('A')).toBe(true)
    expect(text.indexOf('\n')).toBe(72)
    const undecorated = text.slice(0, -1).replace(/\n/g, '')
    const decoded = Buffer.from(undecorated, 'base64')
    const prefix = Buffer.concat([
      Buffer.from('application/octet-stream', 'latin1'),
      Buffer.from([0, 0]),
      Buffer.from('Serato BeatGrid', 'latin1'),
      Buffer.from([0]),
    ])
    expect(decoded.subarray(0, prefix.length).equals(prefix)).toBe(true)
    expect(
      decoded.subarray(prefix.length).equals(seratoBeatgridPayload({ bpm: 128, anchorSec: 0.052 })),
    ).toBe(true)
  })
})
