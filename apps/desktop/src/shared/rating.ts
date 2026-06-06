// Traktor (and Windows Media Player) store a star rating as a single 0–255 byte
// in steps of 51: 1★ = 51, 2★ = 102, 3★ = 153, 4★ = 204, 5★ = 255. The byte goes
// in the ID3 POPM frame (MP3/AIFF/WAV); on FLAC, Traktor writes the whole POPM
// string "<user>|<byte>|<playcount>" into a Vorbis RATING comment.
export const RATING_STEP = 51
export const TRAKTOR_RATING_USER = 'traktor@native-instruments.de'

export function starsToRating(stars: number): number {
  const clamped = Math.max(0, Math.min(5, Math.round(stars)))
  return clamped * RATING_STEP
}

export function ratingToStars(value: number): number {
  return Math.max(0, Math.min(5, Math.round(value / RATING_STEP)))
}

// The FLAC Vorbis RATING value, mirroring exactly what Traktor writes.
export function formatRatingTag(stars: number): string {
  return `${TRAKTOR_RATING_USER}|${starsToRating(stars)}|0`
}

// Reads a raw RATING tag value back to a "1"–"5" string, or "" when missing.
// Accepts both a plain byte ("204") and the POPM string ("user|204|0"). Empty
// means "no rating", which the writer leaves untouched rather than clearing.
export function ratingTagToStars(raw: string): string {
  if (!raw.trim()) return ''
  const parts = raw.split('|')
  const byte = Number(parts.length >= 2 ? parts[1] : raw)
  if (!Number.isFinite(byte)) return ''
  const stars = ratingToStars(byte)
  return stars > 0 ? String(stars) : ''
}
