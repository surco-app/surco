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

// Frees the covers a whole batch of rows just gave up — rows removed from the list, or a
// selection that just took a new cover — keeping any blob a surviving row still shows.
//
// Weighing the batch as a whole is the correctness point, not just the speed one. Asking
// per row "does anyone else still hold this blob?" is answered by the row's own not-yet-
// removed siblings, so a cover applied across a selection survived that selection's own
// removal and leaked for the session. It also collapses the O(rows × tracks) rescan the
// per-row form paid on every batch into one pass.
export function revokeDisplacedCovers(
  displaced: Iterable<string | undefined>,
  kept: Iterable<string | undefined>,
): void {
  const survivors = new Set(kept)
  const freed = new Set<string>()
  for (const url of displaced) {
    if (!url?.startsWith('blob:') || survivors.has(url) || freed.has(url)) continue
    freed.add(url)
    URL.revokeObjectURL?.(url)
  }
}
