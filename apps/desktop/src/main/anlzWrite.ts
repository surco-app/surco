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
    writeBeat(out, PQTZ_HEADER + i * PQTZ_ENTRY, b, tempo)
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

const PQT2_FIRST = 24
const PQT2_LAST = 32

function writeBeat(out: Buffer, at: number, beat: { ms: number; beat: number }, tempo: number) {
  out.writeUInt16BE(beat.beat, at)
  out.writeUInt16BE(tempo, at + 2)
  out.writeUInt32BE(Math.round(beat.ms), at + 4)
}

export function pqt2WithGrid(
  section: Buffer,
  beats: { ms: number; beat: number }[],
  bpm: number,
): Buffer {
  const out = Buffer.from(section)
  const tempo = Math.round(bpm * 100)
  writeBeat(out, PQT2_FIRST, beats[0], tempo)
  writeBeat(out, PQT2_LAST, beats[beats.length - 1], tempo)
  return out
}
