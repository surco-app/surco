// Grouping is a single Apple Music text field, but smart playlists match it with
// "contains", so we store several tags as a comma-separated list. These helpers
// keep that list normalized while users toggle tags on and off.
// `whole` names tags that contain a comma themselves and must never be split.
export function splitCsv(value: string, whole: readonly string[] = []): string[] {
  const kept: string[] = []
  let rest = value
  for (const name of whole) {
    if (!rest.includes(name)) continue
    kept.push(name)
    rest = rest.split(name).join(',')
  }
  const parts = rest
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return kept.length ? orderAsIn(value, [...kept, ...parts]) : parts
}

// The tags in the order they appear in the original text, so toggling one never
// reshuffles the rest.
function orderAsIn(value: string, tags: string[]): string[] {
  return [...tags].sort((a, b) => value.indexOf(a) - value.indexOf(b))
}

export function csvHas(value: string, item: string, whole: readonly string[] = []): boolean {
  return splitCsv(value, whole).includes(item)
}

export function toggleCsv(value: string, item: string, whole: readonly string[] = []): string {
  const parts = splitCsv(value, whole)
  const next = parts.includes(item) ? parts.filter((p) => p !== item) : [...parts, item]
  return next.join(', ')
}
