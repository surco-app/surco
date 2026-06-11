// Frees a picked cover's blob URL. Each picked/dropped image mints one via
// createObjectURL, and an unreleased URL pins the whole image file in memory for
// the session; data:/https covers carry no handle to free. Guarded because jsdom
// ships createObjectURL/revokeObjectURL only partially.
export function revokeCoverUrl(coverUrl: string | undefined): void {
  if (coverUrl?.startsWith('blob:')) URL.revokeObjectURL?.(coverUrl)
}
