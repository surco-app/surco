// rekordbox's analysis files (ANLZ0000.DAT/.EXT/.2EX): a PMAI header and tagged sections,
// all big-endian. Surco reads four things from the local copies (the beat grid for baken's
// XML, the small waveform preview for the export list, the phrases and the colour waveform)
// and fixes one before baken copies
// it to the stick: rekordbox masks the vocal section (PVDI) when it exports and baken does
// not, so Surco masks the staged copy and baken carries it over byte for byte.

import type { Phrase } from '../shared/cueRules'
import type { CueWaveColumn } from '../shared/types'

export interface AnlzSection {
  tag: string
  start: number
  length: number
}

export function anlzSections(buf: Buffer): AnlzSection[] {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'PMAI') return []
  const out: AnlzSection[] = []
  let pos = buf.readUInt32BE(4)
  while (pos + 12 <= buf.length) {
    const length = buf.readUInt32BE(pos + 8)
    if (length < 12 || pos + length > buf.length) break
    out.push({ tag: buf.toString('latin1', pos, pos + 4), start: pos, length })
    pos += length
  }
  return out
}

export interface Beat {
  beat: number
  bpm: number
  ms: number
}

export function beatGrid(dat: Buffer): Beat[] {
  const s = anlzSections(dat).find((x) => x.tag === 'PQTZ')
  if (!s) return []
  const header = dat.readUInt32BE(s.start + 4)
  const count = dat.readUInt32BE(s.start + 20)
  const beats: Beat[] = []
  for (let i = 0; i < count; i++) {
    const at = s.start + header + i * 8
    if (at + 8 > s.start + s.length) break
    beats.push({
      beat: dat.readUInt16BE(at),
      bpm: dat.readUInt16BE(at + 2) / 100,
      ms: dat.readUInt32BE(at + 4),
    })
  }
  return beats
}

// The tiny preview rekordbox draws in its browser (PWAV: 400 columns, height in the low five
// bits). Reduced by maximum so a short peak survives at the export list's size.
export function wavePreview(dat: Buffer, bars = 100): number[] | null {
  const s = anlzSections(dat).find((x) => x.tag === 'PWAV')
  if (!s) return null
  const header = dat.readUInt32BE(s.start + 4)
  const columns = Math.min(dat.readUInt32BE(s.start + 12), s.length - header)
  if (columns <= 0) return null
  const data = dat.subarray(s.start + header, s.start + header + columns)
  return Array.from({ length: bars }, (_, i) => {
    const from = Math.floor((i * columns) / bars)
    const to = Math.max(from + 1, Math.floor(((i + 1) * columns) / bars))
    let top = 0
    for (let c = from; c < to; c++) top = Math.max(top, data[c] & 0x1f)
    return Math.round((top / 31) * 100) / 100
  })
}

// Measured on rekordbox 7.2.19's export (16/10/2026, 5 of 5 tracks exact): a fixed 19-byte
// key from the section's byte 24 (unlike PSSI's, it does not depend on the length), and 0x80
// in byte 12 to say the data is masked.
const PVDI_KEY = Buffer.from('1edd1e1902191b11192318192411fb111e2a15', 'hex')
const EMPTY_PVDI = Buffer.from('505644490000001800000018000004005622000100000000', 'hex')

export function maskVocals(twoEx: Buffer): Buffer {
  const out = Buffer.from(twoEx)
  const s = anlzSections(out).find((x) => x.tag === 'PVDI')
  if (!s) {
    const grown = Buffer.concat([out, EMPTY_PVDI])
    grown.writeUInt32BE(grown.length, 8)
    return grown
  }
  if (s.length <= 24 || (out[s.start + 12] & 0x80) !== 0) return out
  out[s.start + 12] |= 0x80
  for (let i = 24; i < s.length; i++) out[s.start + i] ^= PVDI_KEY[(i - 24) % PVDI_KEY.length]
  return out
}

export const PSSI_KEY = [
  0xcb, 0xe1, 0xee, 0xfa, 0xe5, 0xee, 0xad, 0xee, 0xe9, 0xd2, 0xe9, 0xeb, 0xe1, 0xe9, 0xf3, 0xe8,
  0xe9, 0xf4, 0xe1,
]

export function phrases(ext: Buffer): { mood: number; masked: boolean; entries: Phrase[] } | null {
  const s = anlzSections(ext).find((x) => x.tag === 'PSSI')
  if (!s) return null
  const t = Buffer.from(ext.subarray(s.start, s.start + s.length))
  const count = t.readUInt16BE(16)
  const rawMood = t.readUInt16BE(18)
  const masked = rawMood < 1 || rawMood > 3
  if (masked) for (let x = 18; x < t.length; x++) t[x] ^= (PSSI_KEY[(x - 18) % 19] + count) & 0xff
  const mood = t.readUInt16BE(18)
  if (mood < 1 || mood > 3) return null
  const header = t.readUInt32BE(4)
  const entries: Phrase[] = []
  for (let i = 0; i < count; i++) {
    const at = header + i * 24
    if (at + 6 > t.length) break
    entries.push({ beat: t.readUInt16BE(at + 2), kind: t.readUInt16BE(at + 4) })
  }
  return { mood, masked, entries }
}

export function colorWaveSpanMs(ext: Buffer): number | null {
  const s = anlzSections(ext).find((x) => x.tag === 'PWV5')
  if (!s || s.length < 20) return null
  const header = ext.readUInt32BE(s.start + 4)
  const count = Math.min(ext.readUInt32BE(s.start + 16), Math.floor((s.length - header) / 2))
  return count > 0 ? (count * 1000) / 150 : null
}

export function colorWave(ext: Buffer, columns = 1200): CueWaveColumn[] | null {
  const s = anlzSections(ext).find((x) => x.tag === 'PWV5')
  if (!s) return null
  const header = ext.readUInt32BE(s.start + 4)
  const count = Math.min(ext.readUInt32BE(s.start + 16), Math.floor((s.length - header) / 2))
  if (count <= 0) return null
  const width = Math.min(columns, count)
  const scale = (v: number): number => Math.round((v / 7) * 255)
  return Array.from({ length: width }, (_, i) => {
    const from = Math.floor((i * count) / width)
    const to = Math.max(from + 1, Math.floor(((i + 1) * count) / width))
    let best = -1
    let word = 0
    for (let e = from; e < to; e++) {
      const w = ext.readUInt16BE(s.start + header + e * 2)
      const h = (w >> 2) & 0x1f
      if (h > best) {
        best = h
        word = w
      }
    }
    return {
      h: best / 31,
      rgb: [scale((word >> 13) & 7), scale((word >> 10) & 7), scale((word >> 7) & 7)],
    }
  })
}

export function colorWaveWords(ext: Buffer): Uint16Array | null {
  const s = anlzSections(ext).find((x) => x.tag === 'PWV5')
  if (!s || s.length < 20) return null
  const header = ext.readUInt32BE(s.start + 4)
  const count = Math.min(ext.readUInt32BE(s.start + 16), Math.floor((s.length - header) / 2))
  if (count <= 0) return null
  const words = new Uint16Array(count)
  for (let i = 0; i < count; i++) words[i] = ext.readUInt16BE(s.start + header + i * 2)
  return words
}
