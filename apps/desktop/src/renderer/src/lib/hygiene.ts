import type { TrackMetadata } from '../../../shared/types'

// Track numbering a rip glues to the front of the title: an optional vinyl side letter, the
// number, and a separator. Bare "1 Shake It" is deliberately not matched — "7 Seconds" and
// "99 Problems" look identical to it, so a digit alone needs a separator to count as
// numbering. "A1 Shake It" is safe without one: a side letter has no other reading.
const TITLE_NUMBERING = /^\(?(?:[A-Za-z]\d+|\d+)\)?\s*[.\-)]\s*|^[A-Za-z]\d+\s+/

// A bare leading number, the shape the anchored pattern above refuses to touch on its own.
const BARE_LEADING_NUMBER = /^(\d+)\s+/

// Strips that numbering, closing the gap it leaves. Doing both in one step is the point:
// removing "1." by hand leaves " Shake It" with an orphan leading space, which is half the
// bug this replaces. A title that is only a number ("1999") is left alone — emptying the tag
// is never the intent behind "remove numbering".
//
// `trackNumber` is what rescues the separator-less rips ("05 Last One"). Text alone cannot
// tell those from "7 Seconds", so the tagged position arbitrates: strip the bare number only
// when it IS the track's own position. Compared numerically, since "5", "05" and "A5" all
// name the same track.
export function stripTitleNumbering(title: string, trackNumber = ''): string {
  let stripped = title.replace(TITLE_NUMBERING, '')
  if (stripped === title && matchesPosition(title, trackNumber)) {
    stripped = title.replace(BARE_LEADING_NUMBER, '')
  }
  const clean = stripped.trim()
  return clean ? clean : title
}

// Whether the title's leading number names the same position the track is already tagged
// with. Digits only on both sides: a vinyl "A5" and a plain "05" agree on the 5.
function matchesPosition(title: string, trackNumber: string): boolean {
  const lead = BARE_LEADING_NUMBER.exec(title)?.[1]
  const tagged = trackNumber.replace(/\D/g, '')
  if (!lead || !tagged) return false
  return Number(lead) === Number(tagged)
}

interface HygieneOptions {
  trim: boolean
  zeroPad: boolean
}

export function sanitizeMeta(meta: TrackMetadata, opts: HygieneOptions): TrackMetadata {
  const clean = { ...meta }
  if (opts.trim) {
    for (const key of Object.keys(clean) as (keyof TrackMetadata)[]) {
      const value = clean[key]
      // Optional fields (e.g. discogsReleaseId) may be absent; only clean strings.
      if (typeof value === 'string') clean[key] = value.replace(/\s+/g, ' ').trim()
    }
  }
  // A lettered track number is a vinyl side position ("A1"); padding works on
  // digits and would strip the letter, so it only touches purely numeric values.
  if (opts.zeroPad && !/[A-Za-z]/.test(clean.trackNumber)) {
    const digits = clean.trackNumber.replace(/\D/g, '')
    if (digits) clean.trackNumber = digits.padStart(2, '0')
  }
  return clean
}
