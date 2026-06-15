// Canonical text key for comparing and searching titles/artists. Folds accents
// (so "canción" matches "cancion"), treats "&" as "and", lowercases, and reduces
// every other separator to a single space. Used both to score Discogs matches and
// to filter the track list, so the two never disagree on what counts as equal.
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    // NFD splits "á" into "a" + a combining mark; \p{M} drops the marks, leaving "a".
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
