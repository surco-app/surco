// Traktor stores cue points and the beatgrid inside the audio file as a binary
// tree (ID3 PRIV frame, owner "TRAKTOR4"): little-endian frames of
// [reversed 4-char tag][uint32 length][uint32 child count], cues in a CUEP leaf
// under DATA, each with its position as a millisecond double. The HDR carries a
// CHKS checksum; reverse-engineered against real Traktor-written files here:
// with the CHKS value zeroed, it is the plain byte sum of tree[8 .. N-4]
// (skipping the root tag+length and the last four bytes) — confirmed on five
// independent library files, including one with a non-zero tail that pins the
// -4 exclusion. Trimming the audio shifts every stored position, so the frame
// must be re-anchored, and without a valid CHKS Traktor ignores the whole blob.

const CUE_HEADER_BYTES = 12

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
): Uint8Array | null {
  try {
    const tree = new Uint8Array(source)
    const view = new DataView(tree.buffer, tree.byteOffset, tree.byteLength)
    if (tree.length < CUE_HEADER_BYTES || tagAt(tree, 0) !== 'TRMD') return null
    if (CUE_HEADER_BYTES + view.getUint32(4, true) !== tree.length) return null

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

    for (const { off, len } of cueps) {
      const end = off + len
      let cursor = off
      const count = view.getUint32(cursor, true)
      cursor += 4
      for (let i = 0; i < count; i++) {
        cursor += 4 // constant field (always 1)
        const nameLen = view.getUint32(cursor, true)
        cursor += 4 + nameLen * 2
        cursor += 8 // display order + type
        if (cursor + 16 + 8 > end) throw new Error('cue entry overruns CUEP')
        const start = view.getFloat64(cursor, true)
        let next = Math.max(0, start - shiftMs)
        if (maxMs !== undefined) next = Math.min(next, maxMs)
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
