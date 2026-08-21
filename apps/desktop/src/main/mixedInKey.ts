// Mixed In Key stores its cues in an ID3 GEOB object described "CuePoints", as base64'd
// JSON — nothing like Traktor's binary TRMD tree. A file that went through Mixed In Key
// therefore reaches a FLAC conversion with real, useful cues that Traktor cannot read,
// which is why they used to arrive as nothing (or, before the GEOB fix in tags.ts, as
// whichever unrelated object came first). Translating them once here means the FLAC
// carries the same cue positions in the one shape Traktor does read.

export interface MixedInKeyCue {
  name: string
  startMs: number
}

// Traktor's own analysis writes type 4 (the grid anchor) and type 0 for a plain marker.
// Mixed In Key's cues are all positions, never a phase, so they all come across as 0.
const MARKER_CUE_TYPE = 0

// Mixed In Key marks its payload with this, and nothing else it writes to GEOB carries a
// cues array — but the check is explicit so a future object shaped like this one cannot
// be mistaken for cues.
const MIK_SOURCE = 'mixedinkey'

export function parseMixedInKeyCues(json: string): MixedInKeyCue[] {
  try {
    const parsed = JSON.parse(json) as { cues?: unknown; source?: unknown }
    if (parsed.source !== MIK_SOURCE || !Array.isArray(parsed.cues)) return []
    const out: MixedInKeyCue[] = []
    for (const entry of parsed.cues) {
      const cue = entry as { name?: unknown; time?: unknown }
      if (typeof cue.time !== 'number' || !Number.isFinite(cue.time) || cue.time < 0) continue
      out.push({ name: typeof cue.name === 'string' ? cue.name : '', startMs: cue.time })
    }
    return out
  } catch {
    return []
  }
}

function frame(tag: string, body: Uint8Array, children = 0): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  // The tag is stored reversed, little-endian style, like every length in the tree.
  for (let i = 0; i < 4; i++) out[i] = tag.charCodeAt(3 - i)
  view.setUint32(4, body.length, true)
  view.setUint32(8, children, true)
  out.set(body, 12)
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let off = 0
  for (const part of parts) {
    out.set(part, off)
    off += part.length
  }
  return out
}

function u32(n: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, n, true)
  return out
}

// One CUEP entry, laid out exactly as readTraktorMarkers walks it: a constant, the name as
// UTF-16LE, display order, type, the start and length doubles, repeats, and the hotcue
// slot. -1 for the hotcue leaves the cue as a plain marker rather than claiming a pad.
function cueEntry(name: string, startMs: number, order: number): Uint8Array {
  const out = new Uint8Array(4 + 4 + name.length * 2 + 8 + 16 + 8)
  const view = new DataView(out.buffer)
  let off = 0
  view.setUint32(off, 1, true)
  off += 4
  view.setUint32(off, name.length, true)
  off += 4
  for (const ch of name) {
    view.setUint16(off, ch.charCodeAt(0), true)
    off += 2
  }
  view.setInt32(off, order, true)
  off += 4
  view.setInt32(off, MARKER_CUE_TYPE, true)
  off += 4
  view.setFloat64(off, startMs, true)
  off += 8
  // Length: zero for a marker (a loop would carry its span here).
  view.setFloat64(off, 0, true)
  off += 8
  view.setInt32(off, -1, true)
  off += 4
  view.setInt32(off, -1, true)
  return out
}

// Builds the TRMD tree Traktor reads: HDR (checksum, format stamp, version) plus DATA
// holding the CUEP leaf. The checksum is the plain byte sum of tree[8 .. N-4] with the
// CHKS field itself zeroed — the rule reverse-engineered in traktor4.ts, and without a
// valid one Traktor ignores the whole blob.
export function mixedInKeyCuesToTraktorTree(cues: MixedInKeyCue[]): Uint8Array | null {
  if (cues.length === 0) return null

  const hdr = frame(
    'HDR ',
    concat([frame('CHKS', u32(0)), frame('FMOD', u32(0)), frame('VRSN', u32(4))]),
    3,
  )
  const entries = cues.map((cue, i) => cueEntry(cue.name, cue.startMs, i))
  const cuep = frame('CUEP', concat([u32(cues.length), ...entries]))
  const data = frame('DATA', cuep, 1)
  const tree = frame('TRMD', concat([hdr, data]), 2)

  const chksOff = 12 + 12 + 12
  let sum = 0
  for (let i = 8; i < tree.length - 4; i++) {
    if (i >= chksOff && i < chksOff + 4) continue
    sum = (sum + tree[i]) >>> 0
  }
  new DataView(tree.buffer).setUint32(chksOff, sum, true)
  return tree
}
