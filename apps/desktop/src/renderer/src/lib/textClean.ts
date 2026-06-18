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
