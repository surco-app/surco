import type { TrashEntry, TrashReason } from '../shared/types'

// The seam between the write paths and Surco's trash. convertAudio and
// removeRenamedOriginal call keepOriginal at the moment a user's file is about to be
// replaced or dropped; index.ts points it at the real trash at launch. Unconfigured —
// every unit test that drives a conversion — it keeps nothing and answers null, and the
// callers fall back to what they did before: rename over, unlink.
export type OriginalKeeper = (
  path: string,
  reason: TrashReason,
  outputPath?: string,
) => Promise<TrashEntry | null>

let keeper: OriginalKeeper | null = null

export function configureOriginalKeeper(next: OriginalKeeper | null): void {
  keeper = next
}

export async function keepOriginal(
  path: string,
  reason: TrashReason,
  outputPath?: string,
): Promise<TrashEntry | null> {
  return keeper ? keeper(path, reason, outputPath) : null
}
