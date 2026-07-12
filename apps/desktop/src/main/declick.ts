import type { DeclickMode } from '../shared/types'

// The -af stage for each click-repair mode. 'standard' is adeclick's own defaults
// (window 55 ms, AR order 2%, threshold 2, burst 2), which fully repair the 1-2
// sample impulses a stylus click leaves. 'strong' maxes burst fusion for the long
// pops the defaults miss — calibrated against synthetic 9-sample near-full-scale
// bursts, which survive the defaults untouched and vanish under b=10 alone.
// Two knobs are deliberately NOT part of the preset:
// - threshold: t=1 (or 1.5) reads a large share of any dense mix as clicks, and
//   the per-window AR interpolation cost explodes past realtime — 30 s of pink
//   noise wouldn't finish in 60 s, so real conversions looked hung forever.
//   Detection at the default threshold already catches the long pops; only the
//   fusion of their samples into one repairable burst was missing.
// - window: shrinking it (w=20) made the repair WORSE, not better.
export function declickFilter(mode: DeclickMode): string | null {
  if (mode === 'standard') return 'adeclick'
  if (mode === 'strong') return 'adeclick=b=10'
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
