// Traktor stores a star rating as a single 0–255 byte in steps of 51: 1★ = 51,
// 2★ = 102, 3★ = 153, 4★ = 204, 5★ = 255. The byte goes in the ID3 POPM frame
// (MP3/AIFF/WAV); on FLAC, Traktor writes the whole POPM string
// "<user>|<byte>|<playcount>" into a Vorbis RATING comment.
const RATING_STEP = 51
export const TRAKTOR_RATING_USER = 'traktor@native-instruments.de'

export function starsToRating(stars: number): number {
  const clamped = Math.max(0, Math.min(5, Math.round(stars)))
  return clamped * RATING_STEP
}

// Engine DJ's database stores the star rating as 0–100 in steps of 20 (1★ = 20 …
// 5★ = 100); 0 means unrated. Takes the tag's "1"–"5" string ("" for none) directly.
export function starsTagToEngineRating(tag: string): number {
  const stars = Number.parseInt(tag, 10)
  if (!Number.isFinite(stars)) return 0
  return Math.max(0, Math.min(5, stars)) * 20
}

// Windows Media Player / foobar2000 (%RATING WMP%) read a POPM frame under this
// user, but with a non-linear byte mapping that differs from Traktor's steps of
// 51 — so the same rating needs a second POPM frame to round-trip in both.
export const WMP_RATING_USER = 'Windows Media Player 9 Series'
const WMP_RATING_BYTES = [0, 1, 64, 128, 196, 255]

export function starsToWmpRating(stars: number): number {
  const clamped = Math.max(0, Math.min(5, Math.round(stars)))
  return WMP_RATING_BYTES[clamped]
}

export function ratingToStars(value: number): number {
  return Math.max(0, Math.min(5, Math.round(value / RATING_STEP)))
}

// The FLAC Vorbis RATING value, mirroring exactly what Traktor writes.
export function formatRatingTag(stars: number): string {
  return `${TRAKTOR_RATING_USER}|${starsToRating(stars)}|0`
}

// Reads a raw RATING tag value back to a "1"–"5" string, or "" when missing.
// Accepts a plain byte ("204"), the POPM string ("user|204|0"), and the plain
// "1"–"5" stars mp3tag/foobar2000 write — a byte that small rounds to no stars,
// so the star reading is unambiguous, and without it those ratings read as
// unrated and the FLAC clear-on-empty write would silently delete them.
export function ratingTagToStars(raw: string): string {
  if (!raw.trim()) return ''
  const parts = raw.split('|')
  const plain = Number(raw)
  if (parts.length < 2 && Number.isInteger(plain) && plain >= 1 && plain <= 5) {
    return String(plain)
  }
  const byte = Number(parts.length >= 2 ? parts[1] : raw)
  if (!Number.isFinite(byte)) return ''
  const stars = ratingToStars(byte)
  return stars > 0 ? String(stars) : ''
}
