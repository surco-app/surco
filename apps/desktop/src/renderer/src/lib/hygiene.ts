import type { TrackMetadata } from '../../../shared/types'

// Track numbering a rip glues to the front of the title: an optional vinyl side letter, the
// number, and a separator. Bare "1 Shake It" is deliberately not matched — "7 Seconds" and
// "99 Problems" look identical to it, so a digit alone needs a separator to count as
// numbering. "A1 Shake It" is safe without one: a side letter has no other reading.
const TITLE_NUMBERING = /^\(?(?:[A-Za-z]\d+|\d+)\)?\s*[.\-)]\s*|^[A-Za-z]\d+\s+/

// Strips that numbering, closing the gap it leaves. Doing both in one step is the point:
// removing "1." by hand leaves " Shake It" with an orphan leading space, which is half the
// bug this replaces. A title that is only a number ("1999") is left alone — emptying the tag
// is never the intent behind "remove numbering".
export function stripTitleNumbering(title: string): string {
  const stripped = title.replace(TITLE_NUMBERING, '').trim()
  return stripped ? stripped : title
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
