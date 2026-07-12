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

// How much audio the "hear what gets removed" audition renders. Long enough to
// catch several clicks at vinyl density, short enough that even the strong preset
// renders it in a couple of seconds.
export const PREVIEW_SECONDS = 20

// Where the audition excerpt sits: the middle of the track — intros/outros are the
// quiet grooves, the middle is where the music (and the false-positive risk the
// audition exists to judge) lives. A short or unmeasurable track is taken from the
// start; ffmpeg stops at the real end on its own, so the fixed length can overrun.
export function previewWindow(durationSec: number | null): { start: number; length: number } {
  if (durationSec === null || durationSec <= PREVIEW_SECONDS)
    return { start: 0, length: PREVIEW_SECONDS }
  return { start: durationSec / 2 - PREVIEW_SECONDS / 2, length: PREVIEW_SECONDS }
}

// RX's "output clicks only", as one render: the repaired excerpt phase-inverted and
// mixed back over the source cancels everything the repair kept, leaving only what
// it removed — the proof the user auditions before trusting a mode with their rip.
// amix normalize=0 keeps the raw sum (normalizing would halve both legs and the
// cancellation would still work, but the clicks would play back 6 dB quiet).
export function declickRemovedArgs(
  input: string,
  output: string,
  mode: DeclickMode,
  window: { start: number; length: number },
): string[] | null {
  const filter = declickFilter(mode)
  if (!filter) return null
  // -nostats (not -loglevel error): the render's caller reads adeclick's info-level
  // "Detected clicks" line back off stderr to caption the audition with a count.
  return [
    '-hide_banner',
    '-nostats',
    '-y',
    '-ss',
    String(window.start),
    '-t',
    String(window.length),
    '-i',
    input,
    '-filter_complex',
    `[0:a]asplit=2[a][b];[a]${filter},volume=-1[inv];[b][inv]amix=inputs=2:normalize=0[d]`,
    '-map',
    '[d]',
    '-c:a',
    'pcm_s16le',
    output,
  ]
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
