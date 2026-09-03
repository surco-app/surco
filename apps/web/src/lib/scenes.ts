// The walkthrough scenes as pure functions of progress (0→1). Each one is frozen
// mid-action in the static version — "12/40", "Converting 11/40", the cut already
// placed — so they show the result of something the visitor never sees happen.
// Keeping the state in one frame function per scene means replay, the end state and
// the reduced-motion jump are all the same code path with a different t.

import { DECLICK_MARKS, TAIL_CUT } from './waveforms'

const clamp = (t: number) => Math.min(Math.max(t, 0), 1)

/* ------------------------------------------------------------------- 01 · drop */

// A crate of real 90s eurodance filenames — "Artist 01 - Track 01" is the fastest
// way to tell a DJ he is looking at a mockup. The formats are mixed on purpose: a
// folder that has been collected over years holds shop downloads, vinyl rips and
// whatever a friend sent, and a column of identical FLAC badges reads as filler.
// Lengths are the 12" runtimes the genre actually has, not round numbers.
export const DROP_TRACKS = [
  { name: 'Kaleidos - Take Me To The Limit', format: 'FLAC', duration: '6:12' },
  { name: 'Kalura - Pay For Love', format: 'MP3', duration: '5:48' },
  { name: 'Karen B - Natural Woman', format: 'WAV', duration: '7:03' },
  { name: 'Ken Laszlo - When I Fall In Love', format: 'FLAC', duration: '6:41' },
  { name: 'Kim Sanders - Ride', format: 'AIFF', duration: '5:22' },
  { name: 'Kriss - Tonight', format: 'MP3', duration: '4:57' },
  { name: 'Lia - Private Fantasy', format: 'FLAC', duration: '6:35' },
] as const

// What the whole folder holds, against which the counter runs: the queue shows seven
// rows, but the step is about dropping a crate in, not seven files.
export const DROP_TOTAL = 319

export interface DropRow {
  name: string
  format: string
  duration: string
  state: 'loading' | 'done'
}

export interface DropFrame {
  rows: DropRow[]
  read: number
  total: number
}

// Tracks land one after another and each reads its tags a beat after landing, so the
// queue is visibly filling rather than sitting complete. The previous version passed
// seven rows frozen on "loading" from the outside: the step that promises "drop them
// in and they're there" never showed a single file arriving or finishing.
export function dropFrame(t: number): DropFrame {
  const p = clamp(t)
  const landed = Math.min(DROP_TRACKS.length, Math.floor(p * 1.25 * DROP_TRACKS.length))

  const rows = DROP_TRACKS.slice(0, landed).map(({ name, format, duration }, i) => {
    // Each row needs a moment reading before it settles, which is what makes the
    // queue look like work in flight instead of a list that appeared finished.
    const read = p > (i + 1) / (DROP_TRACKS.length * 1.25) + 0.12
    return {
      name,
      format,
      // The length comes off the file, so it cannot be on screen before the read
      // finishes — that is the difference between showing work and asserting it.
      duration: read ? duration : '',
      state: (read ? 'done' : 'loading') as DropRow['state'],
    }
  })

  return {
    rows,
    read: Math.round((landed / DROP_TRACKS.length) * DROP_TOTAL),
    total: DROP_TOTAL,
  }
}

/* ---------------------------------------------------------------- 02 · tagging */

export const TAG_TOTAL = 40
const TAG_FROM = 8
export const TAG_ARTIST = 'Lil Suzy'
export const TAG_FIELDS = ['Factory Team', '135', 'Fm · 9A', '1995'] as const
export const TAG_QUERY = 'when i fall in love'

export const TAG_MATCHES = [
  { title: 'When I Fall In Love', meta: '1995 · Factory Team · FT-012', src: 'Discogs' },
  { title: 'Euro Club Vol. 3', meta: '1995 · Rise', src: 'Deezer' },
  { title: 'When I Fall In Love', meta: '1996 · self-released', src: 'Bandcamp' },
] as const

// The act the section sells is "tags, in one click", so the scene has to contain the
// click — and everything that makes it meaningful either side. It runs in four beats:
// the query types in, the releases arrive one by one, one gets picked, and only then
// does the artwork drop and the fields fill. An earlier version opened with the
// results already listed and the panels already resolved, which showed the outcome of
// an act the visitor never saw, and left the before/after floating with no file
// attached to it.
const TAG_TYPING_ENDS = 0.22
const TAG_RESULTS_END = 0.48
const TAG_PICK = 0.52

export interface TagFrame {
  done: number
  query: string
  results: number
  activeRow: number
  picked: boolean
  artwork: number
  artist: string
  fields: string[]
}

export function tagFrame(t: number): TagFrame {
  const p = clamp(t)

  const typed = Math.round(Math.min(1, p / TAG_TYPING_ENDS) * TAG_QUERY.length)

  // Results only start landing once there is a query to match, and arrive staggered
  // rather than as a block: a list that appears whole reads as a static mockup.
  const searching = (p - TAG_TYPING_ENDS) / (TAG_RESULTS_END - TAG_TYPING_ENDS)
  const results = Math.max(
    0,
    Math.min(
      TAG_MATCHES.length,
      Math.floor(searching * TAG_MATCHES.length) + (searching > 0 ? 1 : 0),
    ),
  )

  const picked = p >= TAG_PICK

  // Artwork drops in first and the text follows it, which is the order that reads as
  // "the release was applied" rather than as fields being typed by hand.
  const artwork = picked ? Math.min(1, (p - TAG_PICK) / 0.14) : 0

  // The good name types in over the junk one, after the pick — the replacement is the
  // scene's argument, and a swap landing in one frame reads as a rendering glitch.
  const naming = picked ? Math.max(0, (p - TAG_PICK - 0.08) / 0.18) : 0
  const named = Math.round(Math.min(1, naming) * TAG_ARTIST.length)

  return {
    done: Math.round(TAG_FROM + p * (TAG_TOTAL - TAG_FROM)),
    query: TAG_QUERY.slice(0, Math.min(TAG_QUERY.length, typed)),
    results,
    activeRow: picked ? 0 : Math.max(0, results - 1),
    picked,
    artwork,
    artist: TAG_ARTIST.slice(0, named),
    fields: TAG_FIELDS.map((v, i) => (picked && p > TAG_PICK + 0.16 + i * 0.07 ? v : '')),
  }
}

/* ---------------------------------------------------------------- 03 · quality */

// Where the fake's codec wall sits, as a fraction of the image height from the top —
// the 16 kHz edge on a linear scale. The sweep has to travel past it before the
// verdict can appear, because that edge is the evidence for the verdict.
export const SPECTRUM_WALL = 0.273

export interface SpectrumFrame {
  sweep: number
  wall: number
  goodVerdict: boolean
  fakeVerdict: boolean
}

// A scan line crosses both spectra and the verdicts land behind it. The previous
// version drew both images with their badges already attached, which states two
// conclusions without showing Surco reach either — the one step whose whole claim is
// that it inspects the audio for you.
export function spectrumFrame(t: number): SpectrumFrame {
  const p = clamp(t)
  const sweep = Math.min(1, p / 0.72)

  return {
    sweep,
    // The wall draws in as the sweep passes it, so the picture never makes the claim
    // ahead of the analysis.
    wall: Math.max(0, Math.min(1, (sweep - SPECTRUM_WALL) / 0.18)),
    goodVerdict: sweep >= 1,
    fakeVerdict: sweep > SPECTRUM_WALL + 0.18,
  }
}

/* ---------------------------------------------------------------- 04 · declick */

export interface DeclickFrame {
  playhead: number
  found: number
  hitIndex: number | null
  hearingOriginal: boolean
}

export function declickFrame(t: number): DeclickFrame {
  const p = clamp(t)
  const hit = DECLICK_MARKS.findIndex((m) => Math.abs(p - m) < 0.025)
  return {
    playhead: p,
    // Passed clicks stay counted: the scene claims Surco *found* them, so they have
    // to accumulate rather than blink out behind the playhead.
    found: DECLICK_MARKS.filter((m) => m <= p).length,
    hitIndex: hit === -1 ? null : hit,
    // The copy promises you can hear the repair against the original, so the toggle
    // flips on its own instead of sitting on one side claiming it is possible.
    hearingOriginal: (p > 0.35 && p < 0.55) || (p > 0.75 && p < 0.9),
  }
}

/* ------------------------------------------------------------------- 05 · trim */

export const TRIM_CUT = TAIL_CUT

export interface TrimFrame {
  cut: number
  locked: boolean
}

export function trimFrame(t: number): TrimFrame {
  const p = clamp(t)
  // Slides in from the end, overshoots, then settles back onto the last beat with a
  // damped wobble. That settle IS the magnet the copy promises — without it this is
  // a bar sliding to a stop, which oversells what the text claims.
  const overshoot = (1 - TRIM_CUT) * 0.05
  let cut: number
  if (p < 0.72) {
    cut = 1 - (1 - TRIM_CUT) * (p / 0.72) * 1.05
  } else {
    const q = (p - 0.72) / 0.28
    cut = TRIM_CUT + overshoot * Math.cos(q * 9) * (1 - q) * (1 - q)
  }
  return { cut: Math.max(0, Math.min(1, cut)), locked: p > 0.82 }
}

/* -------------------------------------------------------------- 06 · normalize */

// Three tracks bought at three different masters, and the target they all land on.
// Streaming −14 LUFS is the app's own default preset, so the numbers on the page are
// the numbers a visitor will meet in the editor. The quiet one has to rise and the
// hot one has to fall: a set that only moved one way would describe a volume knob.
export const NORMALIZE_TARGET = -14

export const NORMALIZE_TRACKS = [
  { title: 'Kim Sanders - Ride', lufs: -16.4 },
  { title: 'Kriss - Tonight', lufs: -13.1 },
  { title: 'Lia - Private Fantasy', lufs: -7.8 },
] as const

// Where the quietest track sits on the meter, so even the softest bar reads as audio
// rather than an empty track. The rest scale against it by their real dB distance.
const METER_FLOOR = 0.34
const METER_PER_DB = 0.035

const meterLevel = (lufs: number) =>
  Math.min(1, METER_FLOOR + (lufs - NORMALIZE_TRACKS[0].lufs) * METER_PER_DB)

export interface NormalizeBar {
  title: string
  lufs: number
  gain: number
  level: number
}

export interface NormalizeFrame {
  bars: NormalizeBar[]
  matched: boolean
}

export function normalizeFrame(t: number): NormalizeFrame {
  const p = clamp(t)
  // Eased so the bars glide into line instead of snapping; monotonic, so no bar ever
  // passes the target and comes back — an overshoot here would read as the gain
  // hunting, which is not what a constant-gain normalization does.
  const eased = 1 - (1 - p) ** 3
  const target = meterLevel(NORMALIZE_TARGET)

  return {
    bars: NORMALIZE_TRACKS.map(({ title, lufs }) => {
      const from = meterLevel(lufs)
      return {
        title,
        lufs,
        gain: NORMALIZE_TARGET - lufs,
        level: from + (target - from) * eased,
      }
    }),
    matched: p >= 1,
  }
}

/* ------------------------------------------------------------------ 07 · batch */

export const BATCH_QUEUE = [
  { name: 'Jill Dreski — Let Me Know', format: 'AIFF' },
  { name: 'Jo-Ann — Always', format: 'AIFF' },
  { name: 'Ken Laszlo — When I Fall In Love', format: 'AIFF' },
  { name: 'Kim Sanders — Ride', format: 'WAV' },
  { name: 'Kriss — Tonight', format: 'FLAC' },
] as const

export const BATCH_TOTAL = 40
const BATCH_FROM = 3
const DESTINATIONS = 4

export type BatchState = 'idle' | 'working' | 'done'

export interface BatchFrame {
  states: BatchState[]
  rowProgress: number
  done: number
  fill: number
  destinationsLit: number
  finished: boolean
}

export function batchFrame(t: number): BatchFrame {
  const p = clamp(t)
  const pos = p * BATCH_QUEUE.length
  return {
    // >= on the upper bound, or the last track sits at "working" forever once the
    // run completes — the queue would end mid-convert with nothing left to convert.
    states: BATCH_QUEUE.map((_, i) => (pos >= i + 1 ? 'done' : pos > i ? 'working' : 'idle')),
    rowProgress: pos % 1,
    done: Math.round(BATCH_FROM + p * (BATCH_TOTAL - BATCH_FROM)),
    fill: p,
    // Destinations only light once there are files to send: that is the order the
    // real app works in, and lighting them early would misdescribe the product.
    destinationsLit: Array.from({ length: DESTINATIONS }, (_, k) => 0.55 + k * 0.07).filter(
      (threshold) => p > threshold,
    ).length,
    finished: p >= 1,
  }
}
