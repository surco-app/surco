import type { DeclickMode } from '../shared/types'

// The -af stage for each click-repair mode. 'standard' is adeclick's own defaults
// (window 55 ms, AR order 2%, threshold 2, burst 2), which fully repair the 1-2
// sample impulses a stylus click leaves. 'strong' raises burst fusion to the
// MINIMUM that also repairs the long pops the defaults miss (synthetic 9-sample
// near-full-scale bursts: b=3 leaves them, b=4 removes them completely).
//
// The cost calibration matters more than the repair one, because adeclick's
// detector flags 7-17% of any dense club mix as "clicks" (percussive transients)
// and fusion chains those detections into long bursts whose AR interpolation
// explodes superlinearly. Measured on 10 s of a real club track: defaults 0.4 s,
// b=4 1.7 s (stable across excerpts and 96 kHz/24-bit), b=6 5.1 s (slower than
// realtime), b=10 never finished — users reported "hung" conversions twice, first
// for t=1 (which inflates detection itself) and then for b=10. So: never lower
// the threshold, never raise fusion above this minimum, and leave the window
// alone (w=20 made the repair worse).
export function declickFilter(mode: DeclickMode): string | null {
  if (mode === 'standard') return 'adeclick'
  if (mode === 'strong') return 'adeclick=b=4'
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
