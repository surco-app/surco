// Where a converted track ends up. Modeled as one choice rather than two independent
// toggles so "no copy anywhere" can't be expressed: every option keeps at least one copy.
// 'overwrite' rewrites the source file itself in place instead of producing a copy.
// Shared by Settings and the onboarding wizard so the two can never map the choice apart.
export type Destination = 'folder' | 'appleMusic' | 'both' | 'overwrite'

export const DESTINATIONS: Destination[] = ['folder', 'appleMusic', 'both', 'overwrite']

// Reads the stored booleans back as the single radio choice. Overwrite is its own axis
// and wins outright. FLAC can't go to Apple Music, so while it's the format the
// (non-overwrite) destination is pinned to the output folder.
export function toDestination(
  addToAppleMusic: boolean,
  keepOutputCopy: boolean,
  flac: boolean,
  overwriteOriginal: boolean,
): Destination {
  if (overwriteOriginal) return 'overwrite'
  if (flac || !addToAppleMusic) return 'folder'
  return keepOutputCopy ? 'both' : 'appleMusic'
}

// Maps the radio choice onto the stored booleans: Apple Music is added unless the output
// folder is the only destination; the copy is kept unless Apple Music is the only one.
// Overwrite rewrites the source itself, so it adds to neither library destination.
export function fromDestination(d: Destination): {
  addToAppleMusic: boolean
  keepOutputCopy: boolean
  overwriteOriginal: boolean
} {
  if (d === 'overwrite') {
    return { addToAppleMusic: false, keepOutputCopy: true, overwriteOriginal: true }
  }
  return {
    addToAppleMusic: d !== 'folder',
    keepOutputCopy: d !== 'appleMusic',
    overwriteOriginal: false,
  }
}
