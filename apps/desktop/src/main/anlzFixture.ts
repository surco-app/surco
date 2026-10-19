import type { Phrase } from '../shared/cueRules'
import { PSSI_KEY } from './anlz'

const u16 = (n: number): Buffer => {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(n)
  return b
}

export const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

export function section(tag: string, headerRest: Buffer, body: Buffer): Buffer {
  const header = 12 + headerRest.length
  return Buffer.concat([
    Buffer.from(tag, 'latin1'),
    u32(header),
    u32(header + body.length),
    headerRest,
    body,
  ])
}

export function anlzFile(...sections: Buffer[]): Buffer {
  const head = Buffer.concat([
    Buffer.from('PMAI'),
    u32(28),
    u32(0),
    Buffer.from('00000001000100000001000000000000', 'hex'),
  ])
  const out = Buffer.concat([head, ...sections])
  out.writeUInt32BE(out.length, 8)
  return out
}

export function pqtzSection(beatsMs: number[], bpm: number | number[] = 145): Buffer {
  const body = Buffer.concat(
    beatsMs.map((ms, i) => {
      const e = Buffer.alloc(8)
      e.writeUInt16BE((i % 4) + 1, 0)
      e.writeUInt16BE(Math.round((Array.isArray(bpm) ? bpm[i] : bpm) * 100), 2)
      e.writeUInt32BE(ms, 4)
      return e
    }),
  )
  return section('PQTZ', Buffer.concat([u32(0), u32(0x80000), u32(beatsMs.length)]), body)
}

export function pssiSection(mood: number, phrases: Phrase[], masked = false): Buffer {
  const headerRest = Buffer.concat([
    u32(24),
    u16(phrases.length),
    u16(mood),
    Buffer.alloc(6),
    u16(phrases.at(-1)?.beat ?? 0),
    Buffer.alloc(4),
  ])
  const body = Buffer.concat(
    phrases.map((p, i) => Buffer.concat([u16(i + 1), u16(p.beat), u16(p.kind), Buffer.alloc(18)])),
  )
  const out = section('PSSI', headerRest, body)
  if (masked)
    for (let x = 18; x < out.length; x++)
      out[x] ^= (PSSI_KEY[(x - 18) % 19] + phrases.length) & 0xff
  return out
}

export function pwavSection(heights: number[]): Buffer {
  return section(
    'PWAV',
    Buffer.concat([u32(heights.length), u32(0x10000)]),
    Buffer.from(heights.map((h) => h & 0x1f)),
  )
}

export function pwv5Section(entries: { r: number; g: number; b: number; h: number }[]): Buffer {
  const body = Buffer.concat(
    entries.map((e) => u16((e.r << 13) | (e.g << 10) | (e.b << 7) | (e.h << 2))),
  )
  return section('PWV5', Buffer.concat([u32(2), u32(entries.length), u32(0x00960305)]), body)
}
