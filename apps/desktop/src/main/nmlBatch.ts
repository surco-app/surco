import type { NmlPatch } from './traktorNml'

// collection.nml can weigh tens of megabytes, so a conversion batch of 300 tracks
// must produce ONE write, not 300. Accumulate patches in the main process where the
// cue tree already lives as binary data — shipping it to the renderer and back over
// IPC would cross the boundary twice for nothing.
let patches: NmlPatch[] = []

// The renderer's begin/end calls are not guaranteed to nest cleanly: processAll opens
// one begin/end pair around its whole run, but processOne (⌘⏎, the editor's convert
// button) opens its OWN begin/end per call and nothing stops it firing while a batch
// is still open — the UI has no reentrancy guard. If a nested begin reset `patches`,
// a single convert fired mid-batch would silently wipe everything the batch had
// recorded so far. So the accumulator — not the caller — owns correctness: it tracks
// how many begins are currently open and only resets on the OUTERMOST begin, only
// hands patches back (and clears) on the OUTERMOST end. A batch nested inside another
// just adds its patch to the same pool and defers the flush to whoever closes last.
let depth = 0

export function recordNmlPatch(patch: NmlPatch): void {
  patches.push(patch)
}

export function beginNmlBatch(): void {
  if (depth === 0) patches = []
  depth += 1
}

// Returns the accumulated patches once the outermost begin's matching end is reached;
// an inner end (a lone convert closing while a bigger batch is still running around
// it) returns empty and leaves the pool for the outer end to take, so nothing recorded
// so far is lost or handed over early.
export function endNmlBatch(): NmlPatch[] {
  depth = Math.max(0, depth - 1)
  if (depth > 0) return []
  const result = patches
  patches = []
  return result
}
