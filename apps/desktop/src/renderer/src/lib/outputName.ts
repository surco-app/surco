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
