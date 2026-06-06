export type Verdict = 'good' | 'suspect'

export function qualityVerdict(cutoffHz: number, sampleRateHz: number): Verdict {
  if (sampleRateHz <= 0) return 'suspect'
  return cutoffHz >= (sampleRateHz / 2) * 0.85 ? 'good' : 'suspect'
}

export function formatKHz(hz: number): string {
  return `${(hz / 1000).toFixed(1)} kHz`
}

// DJ artwork should be reasonably sharp; Discogs usually serves 600px but some
// releases only carry a small thumbnail. Below this on the smaller side, the
// embedded cover looks soft on CDJ screens — worth telling the user to find better.
export const MIN_COVER_PX = 500

export function isLowResCover(width: number, height: number): boolean {
  const smaller = Math.min(width, height)
  return smaller > 0 && smaller < MIN_COVER_PX
}
