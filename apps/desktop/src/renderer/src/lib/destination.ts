// Where a converted track ends up. Modeled as one choice rather than independent
// toggles so "no copy anywhere" can't be expressed: every option keeps at least one copy.
// 'beside' writes the conversion as a fresh file next to the source, original kept.
// 'overwrite' rewrites the source file itself in place instead of producing a copy.
// Shared by Settings and the onboarding wizard so the two can never map the choice apart.
export type Destination = 'folder' | 'appleMusic' | 'beside' | 'overwrite'

export const DESTINATIONS: Destination[] = ['folder', 'appleMusic', 'beside', 'overwrite']

// Reads the stored booleans back as the single radio choice. Overwrite is its own axis
// and wins outright, then beside-original, which is FLAC-proof (a fresh FLAC beside the
// source is fine). FLAC can't go to Apple Music, so while it's the format the remaining
// destination is pinned to the output folder. keepOutputCopy no longer forks the read:
// the retired "output folder + Apple Music" choice collapses onto Apple Music here, and
// the stored copy flag keeps honoring an old setting until the user next saves.
export function toDestination(
  addToAppleMusic: boolean,
  flac: boolean,
  overwriteOriginal: boolean,
  convertBesideOriginal = false,
): Destination {
  if (overwriteOriginal) return 'overwrite'
  if (convertBesideOriginal) return 'beside'
  if (flac || !addToAppleMusic) return 'folder'
  return 'appleMusic'
}

// Maps the radio choice onto the stored booleans: Apple Music keeps its own imported
// copy, so choosing it drops the output-folder one. Beside-original writes its copy next
// to the source and does not add it to Apple Music. Overwrite rewrites the source
// itself, so it does not add to Apple Music either.
export function fromDestination(d: Destination): {
  addToAppleMusic: boolean
  keepOutputCopy: boolean
  overwriteOriginal: boolean
  convertBesideOriginal: boolean
} {
  if (d === 'overwrite') {
    return {
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: true,
      convertBesideOriginal: false,
    }
  }
  if (d === 'beside') {
    return {
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: false,
      convertBesideOriginal: true,
    }
  }
  return {
    addToAppleMusic: d !== 'folder',
    keepOutputCopy: d !== 'appleMusic',
    overwriteOriginal: false,
    convertBesideOriginal: false,
  }
}
