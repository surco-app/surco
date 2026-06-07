// Human-readable file size from a byte count, in the Finder-style steps (whole KB
// up to a megabyte, then one-decimal MB / two-decimal GB) shown in the Properties
// panel. Returns an empty string for an unreadable size so a failed stat leaves the
// row blank instead of printing "NaN B".
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}
