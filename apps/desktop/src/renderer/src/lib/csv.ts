// Grouping is a single Apple Music text field, but smart playlists match it with
// "contains", so we store several tags as a comma-separated list. These helpers
// keep that list normalized while users toggle tags on and off.
export function splitCsv(value: string, sep = ','): string[] {
  return value
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function csvHas(value: string, item: string, sep = ','): boolean {
  return splitCsv(value, sep).includes(item)
}

export function toggleCsv(value: string, item: string, sep = ','): string {
  const parts = splitCsv(value, sep)
  const next = parts.includes(item) ? parts.filter((p) => p !== item) : [...parts, item]
  return next.join(`${sep} `)
}
