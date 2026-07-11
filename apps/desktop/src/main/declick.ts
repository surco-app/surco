import type { DeclickMode } from '../shared/types'

// The -af stage for each click-repair mode. 'standard' is adeclick's own defaults
// (window 55 ms, AR order 2%, threshold 2, burst 2), which fully repair the 1-2
// sample impulses a stylus click leaves. 'strong' raises the AR order, lowers the
// detection threshold to its floor and maxes burst fusion for the long pops the
// defaults miss — calibrated against synthetic 9-sample near-full-scale bursts,
// which survive the defaults untouched and vanish under a=8:t=1:b=10. The window
// stays at its default: shrinking it (w=20) made the strong preset WORSE, not
// better, so it is deliberately not part of the preset.
export function declickFilter(mode: DeclickMode): string | null {
  if (mode === 'standard') return 'adeclick'
  if (mode === 'strong') return 'adeclick=a=8:t=1:b=10'
  return null
}

// Reads the "Detected clicks in N of M samples" line adeclick prints to stderr at
// end of stream. Summed rather than first-match so a filtergraph that ever splits
// into several adeclick instances still reports one total. null means the line
// never appeared (the filter didn't run), which the caller must keep distinct
// from a genuine "ran and repaired 0".
export function parseDeclickedSamples(stderr: string): number | null {
  let total = 0
  let found = false
  for (const m of stderr.matchAll(/Detected clicks in (\d+) of \d+ samples/g)) {
    total += Number(m[1])
    found = true
  }
  return found ? total : null
}
