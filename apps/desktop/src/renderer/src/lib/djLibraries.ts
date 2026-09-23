// Which collection syncs onboarding should offer, given what was found on this machine.
//
// The step exists only for a DJ who actually runs one of these programs. Offering a
// disabled row to someone who runs neither would be noise in a wizard that promises to
// take under a minute; finding nothing simply removes the step.

export type DjLibraryId = 'rekordbox' | 'traktor'

export interface DetectedDjLibrary {
  id: DjLibraryId
  path: string
}

// Fixed order rather than detection order, so the step reads the same on every machine.
const ORDER: DjLibraryId[] = ['rekordbox', 'traktor']

export function detectedDjLibraries(
  found: Partial<Record<DjLibraryId, string>>,
): DetectedDjLibrary[] {
  return ORDER.filter((id) => found[id]).map((id) => ({ id, path: found[id] as string }))
}
