// rekordbox's analysis files (ANLZ0000.DAT/.EXT/.2EX): a PMAI header and tagged sections,
// all big-endian. Surco reads two things from the local copies (the beat grid for baken's
// XML and the small waveform preview for the export list) and fixes one before baken copies
// it to the stick: rekordbox masks the vocal section (PVDI) when it exports and baken does
// not, so Surco masks the staged copy and baken carries it over byte for byte.

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
