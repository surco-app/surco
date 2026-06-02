// Splits a Discogs track position into a disc and a track number. Discogs writes
// multi-disc CD positions as "disc-track" ("2-3"), so the two must be teased
// apart; vinyl sides ("A1") and bare numbers ("5") carry no disc.
export function splitPosition(position: string): { disc: string; track: string } {
  const m = position.match(/^(\d+)-(\d+)$/)
  if (m) return { disc: m[1], track: m[2] }
  return { disc: '', track: position.replace(/\D/g, '') }
}
