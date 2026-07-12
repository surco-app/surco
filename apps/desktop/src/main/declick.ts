import { declickFilter } from '../shared/declick'
import type { DeclickMode } from '../shared/types'

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

// The touched fraction of the stream (0..1), for the audition caption. A share
// reads honestly where a raw sample count doesn't: on clean dense music the
// detector fires on percussive transients (measured 6-10% on club tracks), and
// "111,919 samples" sounds like a broken file while "6% — listen and judge"
// invites exactly the check the audition exists for. Zero-total flush lines are
// skipped; null when no real report appeared.
export function parseDeclickedShare(stderr: string): number | null {
  let touched = 0
  let total = 0
  for (const m of stderr.matchAll(/Detected clicks in (\d+) of (\d+) samples/g)) {
    touched += Number(m[1])
    total += Number(m[2])
  }
  return total > 0 ? touched / total : null
}
