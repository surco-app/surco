// Traktor stores cue points and the beatgrid inside the audio file as a binary
// tree — an ID3 PRIV frame owned "TRAKTOR4" on MP3/AIFF, the same tree armored
// into a TRAKTOR4 Vorbis comment on FLAC (see base91.ts): little-endian frames of
// [reversed 4-char tag][uint32 length][uint32 child count], cues in a CUEP leaf
// under DATA, each with its position as a millisecond double. The HDR carries a
// CHKS checksum; reverse-engineered against real Traktor-written files here:
// with the CHKS value zeroed, it is the plain byte sum of tree[8 .. N-4]
// (skipping the root tag+length and the last four bytes) — confirmed on five
// independent library files, including one with a non-zero tail that pins the
// -4 exclusion. Trimming the audio shifts every stored position, so the frame
// must be re-anchored, and without a valid CHKS Traktor ignores the whole blob.

const CUE_HEADER_BYTES = 12

// Cue type 4 is Traktor's grid marker (the "AutoGrid" cue a track analysis
// writes). Every other type is a plain position — a hotcue, a load marker, a
// loop — that means "this instant of audio".
const GRID_CUE_TYPE = 4

// The grid marker is the one cue that is not a position but a phase: Traktor
// draws the whole beat ruler by extrapolating from it in both directions, so
// what has to survive a trim is its offset within the beat, not its distance
// from the old start. A silence trim cuts to the first transient, practically
// never a whole number of beats, so subtracting the raw cut lands the ruler
// between beats — the drift users fix by dragging the grid back by hand.
// Folding the shifted position back into the first beat keeps the ruler on the
// same beats it described before, and Traktor extrapolates the rest.
function shiftGridAnchor(start: number, shiftMs: number, beatMs: number): number {
  const moved = start - shiftMs
  return ((moved % beatMs) + beatMs) % beatMs
}

function tagAt(tree: Uint8Array, off: number): string {
  // Tags are stored reversed ("TRMD" on disk means TRMD read back-to-front).
  return String.fromCharCode(tree[off + 3], tree[off + 2], tree[off + 1], tree[off])
}

function checksum(tree: Uint8Array, chksOff: number): number {
  let sum = 0
  for (let i = 8; i < tree.length - 4; i++) {
    // The CHKS value itself is summed as zero — Traktor computes it before
    // writing the field.
    if (i >= chksOff && i < chksOff + 4) continue
    sum = (sum + tree[i]) >>> 0
  }
  return sum >>> 0
}

// Walks a TRMD tree and hands back every CUEP frame's byte span, alongside the
// CHKS offset both callers need to validate the blob. Shared by shiftTraktorCues
// (which rewrites the spans in place) and readTraktorMarkers (which only reads
// them) so the binary layout is parsed in exactly one place — a format change
// only has to be fixed here. Returns null when the tree isn't a well-formed,
// checksum-verified TRMD; both callers treat that as "nothing to do".
function walkTraktorTree(
  tree: Uint8Array,
): { view: DataView; cueps: { off: number; len: number }[]; chksOff: number } | null {
  if (tree.length < CUE_HEADER_BYTES || tagAt(tree, 0) !== 'TRMD') return null
  const view = new DataView(tree.buffer, tree.byteOffset, tree.byteLength)

  let chksOff = -1
  const cueps: { off: number; len: number }[] = []
  const walk = (off: number, end: number): number => {
    if (off + CUE_HEADER_BYTES > end) throw new Error('truncated frame header')
    const tag = tagAt(tree, off)
    const length = view.getUint32(off + 4, true)
    const children = view.getUint32(off + 8, true)
    let cursor = off + CUE_HEADER_BYTES
    if (children > 0) {
      for (let i = 0; i < children; i++) cursor = walk(cursor, end)
      return cursor
    }
    if (cursor + length > end) throw new Error('frame overruns tree')
    if (tag === 'CHKS') {
      if (length !== 4) throw new Error('unexpected CHKS length')
      chksOff = cursor
    }
    if (tag === 'CUEP') cueps.push({ off: cursor, len: length })
    return cursor + length
  }
  const consumed = walk(0, tree.length)
  if (consumed !== tree.length || chksOff === -1) return null

  // Only touch blobs whose checksum we can reproduce: a mismatch means a
  // scheme (or a corruption) we don't understand.
  if (checksum(tree, chksOff) !== view.getUint32(chksOff, true)) return null

  return { view, cueps, chksOff }
}

export interface TraktorMarker {
  name: string
  type: number
  startMs: number
  hotcue: number
}

// Reads the cues and grid anchor back out of a TRMD tree, for copying them into
// the NML as CUE_V2 elements. TYPE=4's startMs is a phase, not a position — see
// shiftGridAnchor above; callers must carry it through unchanged, never clamp it.
export function readTraktorMarkers(tree: Uint8Array): TraktorMarker[] {
  try {
    const walked = walkTraktorTree(tree)
    if (walked === null) return []
    const { view, cueps } = walked

    const markers: TraktorMarker[] = []
    for (const { off, len } of cueps) {
      const end = off + len
      let cursor = off
      const count = view.getUint32(cursor, true)
      cursor += 4
      for (let i = 0; i < count; i++) {
        cursor += 4 // constant field (always 1)
        const nameLen = view.getUint32(cursor, true)
        cursor += 4
        let name = ''
        for (let c = 0; c < nameLen; c++) {
          name += String.fromCharCode(view.getUint16(cursor, true))
          cursor += 2
        }
        cursor += 4 // display order
        const type = view.getInt32(cursor, true)
        cursor += 4
        if (cursor + 16 + 8 > end) throw new Error('cue entry overruns CUEP')
        const startMs = view.getFloat64(cursor, true)
        cursor += 16 // start + length doubles
        cursor += 4 // repeats
        const hotcue = view.getInt32(cursor, true)
        cursor += 4
        markers.push({ name, type, startMs, hotcue })
      }
    }
    return markers
  } catch {
    return []
  }
}

// Re-anchors every cue position after a head trim: each start moves back by
// shiftMs (clamped to 0 — a cue inside the removed lead-in lands on the new
// track start) and, when the tail was cut too, forward positions clamp to the
// new end. Returns the patched tree with its checksum recomputed, or null when
// anything about the blob doesn't match the reverse-engineered format —
// including a stored checksum we cannot reproduce, which would mean a Traktor
// variant whose scheme we don't know and must not overwrite. The caller treats
// null as "drop the frame": carrying provably mis-anchored cues is worse than
// letting Traktor re-analyze.
export function shiftTraktorCues(
  source: Uint8Array,
  shiftMs: number,
  maxMs?: number,
  bpm?: number,
): Uint8Array | null {
  try {
    if (source.length < CUE_HEADER_BYTES || tagAt(source, 0) !== 'TRMD') return null
    // The header's length is authoritative about where the tree ends. An ID3 PRIV
    // frame holds exactly that many bytes, but a FLAC blob comes back from its
    // basE91 armoring padded out to a whole block, so trim a zero tail rather
    // than reject the file. Anything non-zero past the end is not padding.
    const declared =
      CUE_HEADER_BYTES +
      new DataView(source.buffer, source.byteOffset, source.byteLength).getUint32(4, true)
    if (declared > source.length) return null
    for (let i = declared; i < source.length; i++) if (source[i] !== 0) return null

    const tree = new Uint8Array(source.subarray(0, declared))

    // A usable tempo is what makes the grid anchor re-anchorable; without one we
    // can still move plain cues, but a grid marker would have to be guessed at.
    const beatMs = bpm !== undefined && Number.isFinite(bpm) && bpm > 0 ? 60000 / bpm : undefined

    const walked = walkTraktorTree(tree)
    if (walked === null) return null
    const { view, cueps, chksOff } = walked

    for (const { off, len } of cueps) {
      const end = off + len
      let cursor = off
      const count = view.getUint32(cursor, true)
      cursor += 4
      for (let i = 0; i < count; i++) {
        cursor += 4 // constant field (always 1)
        const nameLen = view.getUint32(cursor, true)
        cursor += 4 + nameLen * 2
        cursor += 4 // display order
        const type = view.getInt32(cursor, true)
        cursor += 4
        if (cursor + 16 + 8 > end) throw new Error('cue entry overruns CUEP')
        const start = view.getFloat64(cursor, true)
        let next: number
        if (type === GRID_CUE_TYPE) {
          // No tempo, no phase we can compute: dropping the blob makes Traktor
          // re-analyze, which beats handing back a ruler that is silently off.
          if (beatMs === undefined) return null
          next = shiftGridAnchor(start, shiftMs, beatMs)
        } else {
          next = Math.max(0, start - shiftMs)
          if (maxMs !== undefined) next = Math.min(next, maxMs)
        }
        view.setFloat64(cursor, next, true)
        cursor += 16 // start + length doubles
        cursor += 8 // repeats + hotcue
      }
    }

    view.setUint32(chksOff, checksum(tree, chksOff), true)
    return tree
  } catch {
    return null
  }
}
