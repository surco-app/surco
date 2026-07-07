// Splits a Discogs track position into a disc and a track number. Discogs writes
// multi-disc CD positions as "disc-track" ("2-3"), so the two must be teased
// apart. A vinyl side position ("A1", "B2", or a bare "A" on a 7") IS the track
// number to a collector — Discogs-style taggers write it verbatim — so a side
// letter (repeated on double-A singles: "AA", "AA1") with optional digits passes
// through untouched, with no disc. Anything else (two-letter media labels like
// "CD1" — two DIFFERENT letters) keeps the digits-only fallback.
export function splitPosition(position: string): { disc: string; track: string } {
  const m = position.match(/^(\d+)-(\d+)$/)
  if (m) return { disc: m[1], track: m[2] }
  const p = position.trim()
  if (/^([A-Za-z])\1*\d*$/.test(p)) return { disc: '', track: p }
  return { disc: '', track: position.replace(/\D/g, '') }
}
