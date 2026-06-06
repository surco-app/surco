// Traktor (and Windows Media Player) store a star rating as a single 0–255 byte
// in steps of 51: 1★ = 51, 2★ = 102, 3★ = 153, 4★ = 204, 5★ = 255. The same byte
// goes in the ID3 POPM frame (MP3/AIFF/WAV) and the Vorbis RATING comment (FLAC).
export const RATING_STEP = 51

export function starsToRating(stars: number): number {
  const clamped = Math.max(0, Math.min(5, Math.round(stars)))
  return clamped * RATING_STEP
}

export function ratingToStars(value: number): number {
  return Math.max(0, Math.min(5, Math.round(value / RATING_STEP)))
}

// Reads a raw RATING tag value (as ffprobe reports it) back to a "0"–"5" string,
// or "" when it's missing or not a number. Empty means "no rating", which the
// writer leaves untouched rather than clearing.
export function ratingTagToStars(raw: string): string {
  const n = Number(raw)
  if (!raw.trim() || !Number.isFinite(n)) return ''
  const stars = ratingToStars(n)
  return stars > 0 ? String(stars) : ''
}
