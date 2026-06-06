import type { TrackMetadata } from '../../../shared/types'

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
  if (opts.zeroPad) {
    const digits = clean.trackNumber.replace(/\D/g, '')
    if (digits) clean.trackNumber = digits.padStart(2, '0')
  }
  return clean
}
