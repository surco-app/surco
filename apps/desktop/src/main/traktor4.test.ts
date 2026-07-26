import { describe, expect, it } from 'vitest'
import { shiftTraktorCues } from './traktor4'
import {
  buildTraktorTree as buildTree,
  traktorCue as cue,
  readTraktorCueStart as readStart,
} from './traktor4Fixture'

describe('shiftTraktorCues', () => {
  // The core of djotas's report: after cutting N seconds of lead-in, every cue
  // must land N seconds earlier — and the checksum must re-validate or Traktor
  // ignores the whole frame. The grid marker rides along on its own phase rule
  // (covered below); a hotcue moves by the raw cut.
  it('re-anchors cue positions and recomputes a self-consistent checksum', () => {
    const tree = buildTree([cue('AutoGrid', 4, 65.61, 0), cue('Drop', 0, 61234.5, 1)])
    const shifted = shiftTraktorCues(tree, 1300, undefined, 143.78)
    expect(shifted).not.toBeNull()
    expect(shifted?.length).toBe(tree.length)
    expect(readStart(shifted as Uint8Array, 1)).toBeCloseTo(59934.5)
    // Idempotence of the scheme: the patched tree's stored checksum must be the
    // one the parser itself reproduces, or a second pass would refuse it.
    expect(shiftTraktorCues(shifted as Uint8Array, 0, undefined, 143.78)).not.toBeNull()
  })

  // djotas's actual complaint: the hot cues land right but the grid comes out
  // shifted, so he drags it back by hand every time. The grid anchor is a phase,
  // not a position — Traktor extrapolates the whole beat ruler from it in both
  // directions, so what must survive a trim is its offset within the beat. At his
  // 143.78 BPM the beat is 417.30 ms; cutting 1300 ms from an anchor at 500 ms
  // gives -800, which folds back into the first beat as -800 + 2*417.30 = 34.61.
  // The old code clamped that to 0 and put the ruler out by 34.61 ms — under a
  // beat, but audible drift that compounds across the track.
  it('keeps the grid anchor in phase when the cut is not a whole beat', () => {
    const tree = buildTree([cue('AutoGrid', 4, 500, 0)])
    const shifted = shiftTraktorCues(tree, 1300, undefined, 143.78)
    expect(shifted).not.toBeNull()
    expect(readStart(shifted as Uint8Array, 0)).toBeCloseTo(34.61, 1)
  })

  // Re-anchoring a grid marker needs the beat length. Without a tempo we would
  // have to guess the phase, so the blob goes rather than hand Traktor a ruler
  // that looks intact and isn't — same call the parser already makes for a
  // checksum it can't reproduce.
  it('refuses to re-anchor a grid marker with no tempo to phase it against', () => {
    const tree = buildTree([cue('AutoGrid', 4, 500, 0)])
    expect(shiftTraktorCues(tree, 1300)).toBeNull()
    expect(shiftTraktorCues(tree, 1300, undefined, 0)).toBeNull()
  })

  // A track with hotcues but no grid marker has no phase to preserve, so a
  // missing tempo must not cost the user their cues.
  it('still moves plain cues when no tempo is available', () => {
    const tree = buildTree([cue('Drop', 0, 61234.5, 1)])
    const shifted = shiftTraktorCues(tree, 1300)
    expect(shifted).not.toBeNull()
    expect(readStart(shifted as Uint8Array, 0)).toBeCloseTo(59934.5)
  })

  it('clamps positions past a tail cut to the new end', () => {
    const tree = buildTree([cue('Outro', 0, 300000, 2)])
    const shifted = shiftTraktorCues(tree, 1000, 240000)
    expect(readStart(shifted as Uint8Array, 0)).toBeCloseTo(240000)
  })

  it('changes nothing but the cue doubles and the checksum', () => {
    const tree = buildTree([cue('Drop', 0, 61234.5, 1)])
    const shifted = shiftTraktorCues(tree, 500) as Uint8Array
    let diffs = 0
    for (let i = 0; i < tree.length; i++) if (tree[i] !== shifted[i]) diffs++
    // 8 bytes of one double plus up to 4 checksum bytes.
    expect(diffs).toBeGreaterThan(0)
    expect(diffs).toBeLessThanOrEqual(12)
  })

  // A stored checksum we cannot reproduce means a Traktor variant (or corruption)
  // whose scheme we don't know: writing our own checksum over it could turn a
  // frame Traktor accepts into one it rejects. Hands off.
  it('refuses a blob whose checksum does not match the known scheme', () => {
    const tree = buildTree([cue('Drop', 0, 1000, 1)])
    // Mutate a byte inside the checksummed span — the final four bytes are
    // excluded from it by design, so the very tail would NOT invalidate it.
    tree[tree.length - 6] ^= 0xff
    expect(shiftTraktorCues(tree, 500)).toBeNull()
  })

  it('refuses malformed trees instead of guessing', () => {
    expect(shiftTraktorCues(new Uint8Array([1, 2, 3]), 500)).toBeNull()
    const tree = buildTree([cue('Drop', 0, 1000, 1)])
    const truncated = tree.slice(0, tree.length - 6)
    expect(shiftTraktorCues(truncated, 500)).toBeNull()
    const wrongMagic = new Uint8Array(tree)
    wrongMagic[0] = 0x58
    expect(shiftTraktorCues(wrongMagic, 500)).toBeNull()
  })
})
