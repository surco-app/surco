// Frees a picked cover's blob URL. Each picked/dropped image mints one via
// createObjectURL, and an unreleased URL pins the whole image file in memory for
// the session; data:/https covers carry no handle to free. Guarded because jsdom
// ships createObjectURL/revokeObjectURL only partially.
export function revokeCoverUrl(coverUrl: string | undefined): void {
  if (coverUrl?.startsWith('blob:')) URL.revokeObjectURL?.(coverUrl)
}

// Frees a blob URL only when no remaining track still references it. Applying one cover
// across a multi-selection makes several tracks share a single blob URL; revoking it
// because one of them dropped or replaced its cover would blank the others. Pass the
// cover URLs of the tracks that keep their cover after the change.
export function revokeCoverUrlIfUnused(
  coverUrl: string | undefined,
  stillReferenced: Iterable<string | undefined>,
): void {
  if (!coverUrl?.startsWith('blob:')) return
  for (const url of stillReferenced) if (url === coverUrl) return
  URL.revokeObjectURL?.(coverUrl)
}
