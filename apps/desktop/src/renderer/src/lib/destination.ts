// Where a converted track ends up. Modeled as one choice rather than two independent
// toggles so "no copy anywhere" can't be expressed: every option keeps at least one copy.
// Shared by Settings and the onboarding wizard so the two can never map the choice apart.
export type Destination = 'folder' | 'appleMusic' | 'both'

export const DESTINATIONS: Destination[] = ['folder', 'appleMusic', 'both']

// Reads the stored booleans back as the single radio choice. FLAC can't go to Apple
// Music, so while it's the format the destination is pinned to the output folder.
export function toDestination(
  addToAppleMusic: boolean,
  keepOutputCopy: boolean,
  flac: boolean,
): Destination {
  if (flac || !addToAppleMusic) return 'folder'
  return keepOutputCopy ? 'both' : 'appleMusic'
}

// Maps the radio choice onto the two stored booleans: Apple Music is added unless the
// output folder is the only destination; the copy is kept unless Apple Music is the only one.
export function fromDestination(d: Destination): {
  addToAppleMusic: boolean
  keepOutputCopy: boolean
} {
  return { addToAppleMusic: d !== 'folder', keepOutputCopy: d !== 'appleMusic' }
}
