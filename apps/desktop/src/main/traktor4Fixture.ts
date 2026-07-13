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
