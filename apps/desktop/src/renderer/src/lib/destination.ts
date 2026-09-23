// Where a converted track ends up. Modeled as one choice rather than independent
// toggles so "no copy anywhere" can't be expressed: every option keeps at least one copy.
// 'engineDj' registers the converted file in the Engine DJ library database while keeping
// the output-folder copy — Engine references the file where it lives, it never imports one.
// 'beside' writes the conversion as a fresh file next to the source, original kept.
// 'overwrite' rewrites the source file itself in place instead of producing a copy.
// Shared by Settings and the onboarding wizard so the two can never map the choice apart.
export type Destination = 'folder' | 'appleMusic' | 'engineDj' | 'beside' | 'overwrite'

export const DESTINATIONS: Destination[] = [
  'folder',
  'appleMusic',
  'engineDj',
  'beside',
  'overwrite',
]

// Reads the stored booleans back as the single radio choice. Overwrite is its own axis
// and wins outright, then beside-original and Engine DJ — both FLAC-proof (a fresh FLAC
// beside the source is fine, and Engine plays it natively). FLAC can't go to Apple
// Music, so while it's the format the remaining destination is pinned to the output
// folder. keepOutputCopy no longer forks the read: the retired "output folder + Apple
// Music" choice collapses onto Apple Music here, and the stored copy flag keeps
// honoring an old setting until the user next saves.
export function toDestination(
  addToAppleMusic: boolean,
  flac: boolean,
  overwriteOriginal: boolean,
  addToEngineDj: boolean,
  convertBesideOriginal = false,
): Destination {
  if (overwriteOriginal) return 'overwrite'
  if (convertBesideOriginal) return 'beside'
  if (addToEngineDj) return 'engineDj'
  if (flac || !addToAppleMusic) return 'folder'
  return 'appleMusic'
}

// Maps the radio choice onto the stored booleans: Apple Music keeps its own imported
// copy, so choosing it drops the output-folder one. Engine DJ always keeps the copy
// (the library row points at it). Beside-original writes its copy next to the source
// and adds to no library. Overwrite rewrites the source itself, so it adds to neither
// library destination.
export function fromDestination(d: Destination): {
  addToAppleMusic: boolean
  keepOutputCopy: boolean
  overwriteOriginal: boolean
  addToEngineDj: boolean
  convertBesideOriginal: boolean
} {
  if (d === 'overwrite') {
    return {
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: true,
      addToEngineDj: false,
      convertBesideOriginal: false,
    }
  }
  if (d === 'beside') {
    return {
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: false,
      addToEngineDj: false,
      convertBesideOriginal: true,
    }
  }
  if (d === 'engineDj') {
    return {
      addToAppleMusic: false,
      keepOutputCopy: true,
      overwriteOriginal: false,
      addToEngineDj: true,
      convertBesideOriginal: false,
    }
  }
  return {
    addToAppleMusic: d !== 'folder',
    keepOutputCopy: d !== 'appleMusic',
    overwriteOriginal: false,
    addToEngineDj: false,
    convertBesideOriginal: false,
  }
}
