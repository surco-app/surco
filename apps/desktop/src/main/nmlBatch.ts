import type { NmlPatch } from './traktorNml'

// collection.nml can weigh tens of megabytes, so a conversion batch of 300 tracks
// must produce ONE write, not 300. Accumulate patches in the main process where the
// cue tree already lives as binary data — shipping it to the renderer and back over
// IPC would cross the boundary twice for nothing. Module-level state allows batch
// operations to collect patches, and sync or cancellation to drain or reset them
// without coupling to any particular conversion flow.
let patches: NmlPatch[] = []

export function recordNmlPatch(patch: NmlPatch): void {
  patches.push(patch)
}

export function takeNmlPatches(): NmlPatch[] {
  const result = patches
  patches = []
  return result
}

export function resetNmlPatches(): void {
  patches = []
}
