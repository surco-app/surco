// Grouping is a single Apple Music text field, but smart playlists match it with
// "contains", so we store several tags as a list in one text. These helpers keep that
// list normalized while users toggle tags on and off.
// `whole` names tags that contain the separator themselves and must never be split.
// `separator` is what joins the tags ("; " for Plex); reading splits on it without its
// spaces, so "Pop;Indie Pop" and "Pop; Indie Pop" are the same two tags.
export const DEFAULT_SEPARATOR = ', '

function splitOn(separator: string): string {
  return separator.trim() || separator
}

export function splitCsv(
  value: string,
  whole: readonly string[] = [],
  separator: string = DEFAULT_SEPARATOR,
): string[] {
  const on = splitOn(separator)
  const kept: string[] = []
  let rest = value
  for (const name of whole) {
    if (!rest.includes(name)) continue
    kept.push(name)
    rest = rest.split(name).join(on)
  }
  const parts = rest
    .split(on)
    .map((s) => s.trim())
    .filter(Boolean)
  return kept.length ? orderAsIn(value, [...kept, ...parts]) : parts
}

// The tags in the order they appear in the original text, so toggling one never
// reshuffles the rest.
function orderAsIn(value: string, tags: string[]): string[] {
  return [...tags].sort((a, b) => value.indexOf(a) - value.indexOf(b))
}

// "electronic" from a provider and "Electronic" from the user's presets are one tag.
function sameTag(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export function csvHas(
  value: string,
  item: string,
  whole: readonly string[] = [],
  separator: string = DEFAULT_SEPARATOR,
): boolean {
  return splitCsv(value, whole, separator).some((p) => sameTag(p, item))
}

export function toggleCsv(
  value: string,
  item: string,
  whole: readonly string[] = [],
  separator: string = DEFAULT_SEPARATOR,
): string {
  const parts = splitCsv(value, whole, separator)
  const next = parts.some((p) => sameTag(p, item))
    ? parts.filter((p) => !sameTag(p, item))
    : [...parts, item]
  return next.join(separator)
}
