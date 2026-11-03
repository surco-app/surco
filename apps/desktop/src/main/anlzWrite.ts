import { anlzSections } from './anlz'

const PQTZ_HEADER = 24
const PQTZ_ENTRY = 8
const PQTZ_FLAGS = 0x80000

export function encodePqtz(beats: { ms: number; beat: number }[], bpm: number): Buffer {
  const out = Buffer.alloc(PQTZ_HEADER + beats.length * PQTZ_ENTRY)
  out.write('PQTZ', 0, 'latin1')
  out.writeUInt32BE(PQTZ_HEADER, 4)
  out.writeUInt32BE(out.length, 8)
  out.writeUInt32BE(PQTZ_FLAGS, 16)
  out.writeUInt32BE(beats.length, 20)
  const tempo = Math.round(bpm * 100)
  beats.forEach((b, i) => {
    const at = PQTZ_HEADER + i * PQTZ_ENTRY
    out.writeUInt16BE(b.beat, at)
    out.writeUInt16BE(tempo, at + 2)
    out.writeUInt32BE(Math.round(b.ms), at + 4)
  })
  return out
}

export function replaceSection(file: Buffer, tag: string, section: Buffer): Buffer {
  const found = anlzSections(file).find((s) => s.tag === tag)
  if (!found) throw new Error(`no ${tag} section`)
  const out = Buffer.concat([
    file.subarray(0, found.start),
    section,
    file.subarray(found.start + found.length),
  ])
  out.writeUInt32BE(out.length, 8)
  return out
}
