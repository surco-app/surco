import { declickFilter } from '../shared/declick'
import type { DeclickMode } from '../shared/types'

// The repaired track, rendered whole, for the A/B against the original. Whole and not
// an excerpt because the point of the preview is to judge the repair *at the clicks* —
// which sit wherever the stylus hit dust, not in a fixed 20 s window — and because the
// marks over the wave invite a jump to any of them.
//
// This deliberately replaces the old "hear what gets removed" render (the repaired
// signal phase-inverted over the source, leaving only what was taken out). That answers
// an engineer's question, not the user's: it proves the filter did *something*, while
// its real failure mode — a repair that eats the attack of a snare — sounds like just
// another click in the removed signal and slips through unnoticed. In the A/B you hear
// it instantly.
export function declickRepairedArgs(
  input: string,
  output: string,
  mode: DeclickMode,
): string[] | null {
  const filter = declickFilter(mode)
  if (!filter) return null
  // -progress pipe:1 machine-parses the render's position on stdout (the render is
  // slow enough to need a bar); -nostats drops the human stderr chatter it replaces.
  return [
    '-hide_banner',
    '-nostats',
    '-progress',
    'pipe:1',
    '-y',
    '-i',
    input,
    '-af',
    filter,
    '-c:a',
    'pcm_s16le',
    output,
  ]
}

// The render's position, off `-progress pipe:1`: out_time_us is microseconds of output
// written. Last value wins — the stream appends a block per update. null when no block
// has landed yet, which the caller must keep distinct from a genuine zero.
export function parseProgressSeconds(stdout: string): number | null {
  let last: number | null = null
  for (const m of stdout.matchAll(/out_time_us=(\d+)/g)) last = Number(m[1]) / 1_000_000
  return last
}

// Reads the "Detected clicks in N of M samples" line adeclick prints at
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
