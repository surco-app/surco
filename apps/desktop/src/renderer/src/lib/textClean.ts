// Strips bracketed mix/label provenance — "(Original Mix)", "[Label 001]" — from a
// title or album and collapses the leftover whitespace. Used to propose a clean
// album from a track title that still carries its mix name. Mirrors the main-process
// search cleaner, but lives in the renderer so the field menu needs no IPC hop.
export function stripParentheticals(text: string): string {
  return text
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export type AlbumCleanContext = {
  isMulti: boolean
  meta: { album?: string; title?: string }
}

// "Without version" proposal for the album menu: strip the mix/label parenthetical
// from the album, or from the title when the album is still empty (the common case
// for a single release). Only set when stripping actually removes something, so the
// menu offers the row only when there is a version to drop.
export function proposeAlbumClean({ isMulti, meta }: AlbumCleanContext): string | undefined {
  const source = isMulti ? '' : (meta.album ?? '').trim() || (meta.title ?? '')
  const clean = stripParentheticals(source)
  return clean && clean !== source ? clean : undefined
}
