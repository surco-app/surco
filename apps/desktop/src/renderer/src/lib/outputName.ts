import type { TrackMetadata } from '../../../shared/types'

export function renderOutputName(format: string, meta: TrackMetadata): string {
  const filled = format.replace(/\{(\w+)\}/g, (_, key) => {
    const value = (meta as unknown as Record<string, string>)[key]
    // Strip path separators from a field's value so e.g. "AC/DC" never spills into a
    // folder; only a literal "/" the user writes in the template splits directories.
    return value ? value.trim().replace(/[/\\]/g, '-') : ''
  })
  // "/" in the template means a subfolder, so clean each segment on its own (collapsing
  // separators, trimming edges) without touching the slashes, and drop a segment a blank
  // field left empty so no stray "" directory is produced.
  return filled
    .split('/')
    .map((segment) =>
      segment
        // A blank field inside "({year})"-style wrapping leaves empty "()" / "[]" behind;
        // drop the pair so the name doesn't ship with stray brackets.
        .replace(/\(\s*\)|\[\s*\]/g, '')
        .replace(/\s*-\s*-\s*/g, ' - ')
        .replace(/\s+/g, ' ')
        .replace(/^[\s\-–·_]+|[\s\-–·_]+$/g, '')
        .trim(),
    )
    .filter(Boolean)
    .join('/')
}

// The title-format sibling of renderOutputName: fills the same {tokens} but treats
// the result as a tag value, not a path — slashes in values and pattern stay plain
// text. Shares the blank-field hygiene: empty "()"/"[]" pairs and doubled
// separators left by a field the track doesn't have are dropped, edges trimmed.
export function renderTitle(format: string, meta: TrackMetadata): string {
  return format
    .replace(/\{(\w+)\}/g, (_, key) => {
      const value = (meta as unknown as Record<string, string>)[key]
      return value ? value.trim() : ''
    })
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s*-\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–·_]+|[\s\-–·_]+$/g, '')
    .trim()
}

// Stands in for {title} when probing what a pattern wraps AROUND the title; a
// control character so it can never collide with real tag text, and it passes
// renderTitle's cleanup untouched (it is neither bracket, separator nor space).
const TITLE_SENTINEL = '\u0001'

// The per-track rename patches an "apply the title format" pass produces: one entry
// per track whose rendered title is non-empty AND different from the current one.
// A title that already carries the pattern's rendered prefix and suffix is treated
// as formatted and skipped, so re-applying is idempotent — pressing the T button
// twice must never stack "(B2) (B2) …". Pure and shared by the editor's T button,
// the title menu's row and the ⌘K command, so every trigger agrees on what counts
// as a no-op and the caller can say so instead of silently doing nothing.
export function titleFormatPatches(
  format: string,
  tracks: { id: string; meta: TrackMetadata }[],
): { id: string; meta: { title: string } }[] {
  return tracks.flatMap((t) => {
    const current = t.meta.title ?? ''
    const title = renderTitle(format, t.meta)
    if (!title || title === current) return []
    const wrapped = renderTitle(format, { ...t.meta, title: TITLE_SENTINEL })
    const cut = wrapped.indexOf(TITLE_SENTINEL)
    if (cut !== -1) {
      const prefix = wrapped.slice(0, cut)
      const suffix = wrapped.slice(cut + TITLE_SENTINEL.length)
      const alreadyFormatted =
        (prefix !== '' || suffix !== '') &&
        current.length >= prefix.length + suffix.length &&
        current.startsWith(prefix) &&
        current.endsWith(suffix)
      if (alreadyFormatted) return []
    }
    return [{ id: t.id, meta: { title } }]
  })
}
