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

// What a recovered field must look like for the inverse match to accept it. Without a
// shape, "{trackNumber} - {title}" would eat the first words of any dashed title
// ("My Song - Remix" → trackNumber "My Song"); with it, only a plausible value counts:
// a vinyl position ("A", "A2", "AA1"), a plain number ("01", "12"), a short year. Fields
// with no entry (artist, album…) stay free-text, matched lazily.
const FIELD_SHAPES: Record<string, string> = {
  trackNumber: '(?:[A-Za-z]{1,2}\\d{0,3}|\\d{1,3})',
  discNumber: '\\d{1,2}',
  year: '\\d{2,4}',
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Every subset of the pattern's non-title tokens, largest first — one per way the
// rendered title may have dropped a blank field's brackets. Largest first so the
// fullest layout that matches wins and a shorter one can't shadow it.
function subsetsBySizeDesc(items: string[]): string[][] {
  const out: string[][] = []
  for (let mask = (1 << items.length) - 1; mask >= 0; mask--) {
    out.push(items.filter((_, i) => mask & (1 << i)))
  }
  return out.sort((a, b) => b.length - a.length)
}

// The inverse of renderTitle: given the configured pattern and a title tag that (maybe)
// wears it, recover the bare {title} and the fields the pattern wrapped around it. This
// is what lets the matcher score a "(A2) Sueño Latino (1998)" tag as "Sueño Latino" —
// the pattern the app itself applied must never bury its own re-match. Each candidate
// layout is rebuilt through renderTitle with sentinel values (so the blank-field hygiene
// — dropped "()" pairs, collapsed separators — can never drift from the render side) and
// tried as an anchored regex, fullest first; the all-blank layout collapses to just the
// title, so an unformatted title matches that and comes back unchanged. Returns
// undefined only when the pattern carries no {title} (nothing to recover) or no layout
// matches at all.
export function unformatTitle(
  format: string,
  title: string,
): { title: string; fields: Partial<Record<string, string>> } | undefined {
  const keys = [...new Set([...format.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))]
  if (!keys.includes('title')) return undefined
  const others = keys.filter((k) => k !== 'title')
  // One control character per field, like TITLE_SENTINEL: they survive renderTitle's
  // cleanup and can never collide with real tag text.
  const sentinelOf = new Map(others.map((k, i) => [k, String.fromCharCode(2 + i)]))
  for (const present of subsetsBySizeDesc(others)) {
    const values: Record<string, string> = { title: TITLE_SENTINEL }
    for (const k of present) values[k] = sentinelOf.get(k) as string
    const layout = renderTitle(format, values as unknown as TrackMetadata)
    if (!layout.includes(TITLE_SENTINEL)) continue
    let pattern = escapeRegExp(layout)
    for (const key of ['title', ...present]) {
      const sentinel = key === 'title' ? TITLE_SENTINEL : (sentinelOf.get(key) as string)
      const shape = key === 'title' ? '.+' : (FIELD_SHAPES[key] ?? '.+?')
      const parts = pattern.split(sentinel)
      // A token repeated in the pattern must match the same text everywhere, so the
      // first occurrence captures and the rest backreference it.
      pattern =
        parts[0] +
        parts
          .slice(1)
          .map((p, i) => (i === 0 ? `(?<${key}>${shape})` : `\\k<${key}>`) + p)
          .join('')
    }
    const m = title.trim().match(new RegExp(`^${pattern}$`))
    if (!m?.groups) continue
    const bare = m.groups.title.trim()
    if (!bare) continue
    const fields: Partial<Record<string, string>> = {}
    for (const k of present) if (m.groups[k]) fields[k] = m.groups[k]
    return { title: bare, fields }
  }
  return undefined
}

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

// The pattern's {tokens} (minus {title}) that are empty on EVERY given track, in
// pattern order — the concrete "why" behind a no-op apply, so the toast can name
// the missing field ("Track No. is empty") instead of a generic "nothing changed".
// {title} is the field being rebuilt, not an input the user could go fill.
export function emptyTitleFormatFields(
  format: string,
  tracks: { id: string; meta: TrackMetadata }[],
): string[] {
  const keys = [...format.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
  return [...new Set(keys)].filter(
    (key) =>
      key !== 'title' &&
      tracks.length > 0 &&
      tracks.every((t) => !(t.meta as unknown as Record<string, string>)[key]?.trim()),
  )
}

// Everything one "apply the title format" pass needs to report honestly: the
// patches to apply, how many tracks were skipped (no-op: empty render, unchanged,
// or already wearing the pattern), and — when nothing at all changed — which
// pattern fields are empty on every track, as the concrete "why".
export function titleFormatSummary(
  format: string,
  tracks: { id: string; meta: TrackMetadata }[],
): {
  patches: { id: string; meta: { title: string } }[]
  skipped: number
  missingFields: string[]
} {
  const patches = titleFormatPatches(format, tracks)
  return {
    patches,
    skipped: tracks.length - patches.length,
    missingFields: patches.length === 0 ? emptyTitleFormatFields(format, tracks) : [],
  }
}
