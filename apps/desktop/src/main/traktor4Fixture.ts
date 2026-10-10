import { readFileSync, writeFileSync } from 'node:fs'
import {
  Id3v2PrivateFrame,
  type Id3v2Tag,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import { decodeBase91 } from './base91'

// Builders for a TRAKTOR4 tree structurally identical to what real Traktor
// writes (TRMD > [HDR > CHKS/FMOD/VRSN, DATA > CUEP + opaque tail]), shared by
// the traktor4 and tags test suites so both exercise the same byte layout the
// parser was reverse-engineered against. Imported by tests only.

export function traktorFrame(tag: string, body: Uint8Array, children = 0): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  for (let i = 0; i < 4; i++) out[i] = tag.charCodeAt(3 - i)
  new DataView(out.buffer).setUint32(4, body.length, true)
  new DataView(out.buffer).setUint32(8, children, true)
  out.set(body, 12)
  return out
}

export function traktorConcat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

export function traktorCue(name: string, type: number, startMs: number, hot: number): Uint8Array {
  const out = new Uint8Array(4 + 4 + name.length * 2 + 8 + 16 + 8)
  const v = new DataView(out.buffer)
  let o = 0
  v.setUint32(o, 1, true)
  o += 4
  v.setUint32(o, name.length, true)
  o += 4
  for (const ch of name) {
    out[o] = ch.charCodeAt(0)
    o += 2
  }
  v.setInt32(o, 0, true)
  o += 4
  v.setInt32(o, type, true)
  o += 4
  v.setFloat64(o, startMs, true)
  o += 8
  v.setFloat64(o, 0, true)
  o += 8
  v.setInt32(o, -1, true)
  o += 4
  v.setInt32(o, hot, true)
  return out
}

function u32(n: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, n, true)
  return out
}

// The opaque trailing blob ends in non-zero bytes on purpose: the checksum's
// "skip the last four bytes" rule is invisible with a zero tail, and a fixture
// that can't tell the spans apart can't guard it.
export function buildTraktorTree(cues: Uint8Array[]): Uint8Array {
  const hdr = traktorFrame(
    'HDR ',
    traktorConcat([
      traktorFrame('CHKS', u32(0)),
      traktorFrame('FMOD', u32(0x07e10b0c)),
      traktorFrame('VRSN', u32(4)),
    ]),
    3,
  )
  const cuep = traktorFrame('CUEP', traktorConcat([u32(cues.length), ...cues]))
  const tail = traktorFrame('TRN3', new Uint8Array([9, 8, 7, 6, 5, 0x2e, 0x94, 0xfc, 0x3c]))
  const data = traktorFrame('DATA', traktorConcat([cuep, tail]), 2)
  const tree = traktorFrame('TRMD', traktorConcat([hdr, data]), 2)
  const chksOff = 12 + 12 + 12
  let sum = 0
  for (let i = 8; i < tree.length - 4; i++) {
    if (i >= chksOff && i < chksOff + 4) continue
    sum = (sum + tree[i]) >>> 0
  }
  new DataView(tree.buffer).setUint32(chksOff, sum, true)
  return tree
}

// Reads back a cue's start double, for asserting what a shift wrote.
export function readTraktorCueStart(tree: Uint8Array, cueIndex: number): number {
  const view = new DataView(tree.buffer, tree.byteOffset, tree.byteLength)
  let off = tree.length
  for (let i = 0; i < tree.length - 4; i++) {
    if (tree[i] === 0x50 && tree[i + 1] === 0x45 && tree[i + 2] === 0x55 && tree[i + 3] === 0x43) {
      off = i + 12
      break
    }
  }
  let cursor = off + 4
  for (let i = 0; i <= cueIndex; i++) {
    cursor += 4
    const nameLen = view.getUint32(cursor, true)
    cursor += 4 + nameLen * 2 + 8
    if (i === cueIndex) return view.getFloat64(cursor, true)
    cursor += 16 + 8
  }
  throw new Error('cue not found')
}

// A raw ID3v2.3 tag holding Traktor's PRIV frame — the shape a real Traktor-written MP3
// or AIFF carries, and the one this matrix asserts on the way out.
export function id3WithPriv(tree: Uint8Array): Buffer {
  const body = Buffer.concat([
    Buffer.from('TRAKTOR4', 'latin1'),
    Buffer.from([0]),
    Buffer.from(tree),
  ])
  const head = Buffer.alloc(10)
  head.write('PRIV', 0, 'latin1')
  head.writeUInt32BE(body.length, 4)
  const frame = Buffer.concat([head, body])
  const syncsafe = (n: number) =>
    Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(frame.length), frame])
}

// Appends an AIFF 'ID3 ' chunk holding the cue tag, fixing up the FORM size.
export function injectAiffPriv(path: string, tree: Uint8Array): void {
  const base = readFileSync(path)
  const id3 = id3WithPriv(tree)
  const body = id3.length % 2 ? Buffer.concat([id3, Buffer.from([0])]) : id3
  const size = Buffer.alloc(4)
  size.writeUInt32BE(id3.length)
  const out = Buffer.concat([base, Buffer.from('ID3 '), size, body])
  out.writeUInt32BE(out.length - 8, 4)
  writeFileSync(path, out)
}

// Appends a RIFF 'id3 ' chunk to a WAV, fixing up the RIFF size.
export function injectWavPriv(path: string, tree: Uint8Array): void {
  const base = readFileSync(path)
  const id3 = id3WithPriv(tree)
  const body = id3.length % 2 ? Buffer.concat([id3, Buffer.from([0])]) : id3
  const size = Buffer.alloc(4)
  size.writeUInt32LE(id3.length)
  const out = Buffer.concat([base, Buffer.from('id3 '), size, body])
  out.writeUInt32LE(out.length - 8, 4)
  writeFileSync(path, out)
}

// The cue tree as the destination container actually stores it: a PRIV frame for the ID3
// families, the armored Vorbis comment for FLAC. Returns null when neither is present —
// which is exactly the "cues silently lost" outcome this matrix is looking for.
export function storedTree(file: string): Uint8Array | null {
  const f = TagFile.createFromPath(file)
  try {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    const priv = (id3?.frames ?? []).find(
      (fr) => fr instanceof Id3v2PrivateFrame && fr.owner === 'TRAKTOR4',
    ) as Id3v2PrivateFrame | undefined
    if (priv) return priv.privateData.toByteArray()
    const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment | null
    const armored = xiph?.getField('TRAKTOR4')?.[0]
    return armored ? decodeBase91(armored) : null
  } finally {
    f.dispose()
  }
}
