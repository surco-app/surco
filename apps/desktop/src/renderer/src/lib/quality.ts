export type Verdict = 'good' | 'suspect'

export function qualityVerdict(cutoffHz: number, sampleRateHz: number): Verdict {
  if (sampleRateHz <= 0) return 'suspect'
  return cutoffHz >= (sampleRateHz / 2) * 0.85 ? 'good' : 'suspect'
}

export function formatKHz(hz: number): string {
  return `${(hz / 1000).toFixed(1)} kHz`
}
