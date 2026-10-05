// The walkthrough scenes as pure functions of progress (0→1). Each one is frozen
// mid-action in the static version — "12/40", "Converting 11/40", the cut already
// placed — so they show the result of something the visitor never sees happen.
// Keeping the state in one frame function per scene means replay, the end state and
// the reduced-motion jump are all the same code path with a different t.

import { CRATE } from './crate'
import { DECLICK_MARKS, TAIL_CUT } from './waveforms'

const clamp = (t: number) => Math.min(Math.max(t, 0), 1)

/* ------------------------------------------------------------------- 01 · drop */

// Real tracks with their real covers. The formats are mixed on purpose: a folder
// collected over years holds shop downloads, vinyl rips and whatever a friend sent, and
// a column of identical badges reads as filler.
export const DROP_TRACKS = [
  { ...CRATE.sash, format: 'FLAC' },
  { ...CRATE.milk, format: 'WAV' },
  { ...CRATE.sylver, format: 'MP3' },
  { ...CRATE.lasgo, format: 'AIFF' },
  { ...CRATE.ivd, format: 'FLAC' },
  { ...CRATE.tukan, format: 'WAV' },
  { ...CRATE.bullet, format: 'MP3' },
] as const

// What the whole folder holds, against which the counter runs: the list shows seven
// rows, but the step is about dropping a crate in, not seven files.
export const DROP_TOTAL = 319

const DROP_DRAG = 0.12
const DROP_LANDS = 0.3
const DROP_READ_ENDS = 0.86

export interface DropRow {
  title: string
  artist: string
  duration: string
  cover: string
  format: string
  state: 'loading' | 'done'
}

export interface DropFrame {
  stage: 'empty' | 'dragging' | 'reading' | 'done'
  rows: DropRow[]
  read: number
  total: number
}

// The empty window, the files dragged onto it, then the app's own import: every row
// listed at once as a placeholder and each one read in turn while the toolbar counts.
export function dropFrame(t: number): DropFrame {
  const p = clamp(t)
  const reading = clamp((p - DROP_LANDS) / (DROP_READ_ENDS - DROP_LANDS))
  const landed = p >= DROP_LANDS
  const read = landed ? Math.floor(reading * DROP_TRACKS.length) : 0
  return {
    stage: !landed ? (p < DROP_DRAG ? 'empty' : 'dragging') : reading < 1 ? 'reading' : 'done',
    rows: landed
      ? DROP_TRACKS.map(({ title, artist, duration, cover, format }, i) => ({
          title,
          artist,
          duration,
          cover,
          format,
          state: i < read ? 'done' : 'loading',
        }))
      : [],
    read: landed ? Math.round(reading * DROP_TOTAL) : 0,
    total: DROP_TOTAL,
  }
}
/* ---------------------------------------------------------------- 02 · tagging */

export const TAG_TRACK = CRATE.karen
export const TAG_ARTIST = TAG_TRACK.artist

// What the file carried before the release was applied: the kind of string a badly
// ripped download leaves in the artist tag.
export const TAG_JUNK_ARTIST = '2-2-2c-2e-1-2c-2e-1-2y4c-EF'
export const TAG_FIELDS = [TAG_TRACK.album, TAG_TRACK.year, TAG_TRACK.genre] as const
export const TAG_QUERY = 'Karen B Natural Woman'

export const TAG_MATCHES = [
  {
    title: 'Karen B - Natural Woman',
    src: 'Discogs',
    meta: '1995 · Flarenasch',
    cover: TAG_TRACK.cover,
  },
  { title: 'Karen B - Natural Woman', src: 'Deezer', meta: '1995', cover: TAG_TRACK.cover },
  { title: 'Karen B - Natural Woman', src: 'MusicBrainz', meta: '1995', cover: '' },
] as const

// The act the section sells is "tags, in one click", so the scene has to contain the
// click and what makes it meaningful either side, in the app's order: the query types
// in, the releases arrive one by one, the first opens to its tracks, one track gets
// picked, and only then does the artwork drop and the fields fill.
const TAG_TYPING_ENDS = 0.22
const TAG_RESULTS_END = 0.44
const TAG_OPEN = 0.47
const TAG_PICK = 0.55

export interface TagFrame {
  query: string
  results: number
  open: boolean
  picked: boolean
  artwork: number
  artist: string
  fields: string[]
}

export function tagFrame(t: number): TagFrame {
  const p = clamp(t)

  const typed = Math.round(Math.min(1, p / TAG_TYPING_ENDS) * TAG_QUERY.length)

  const searching = (p - TAG_TYPING_ENDS) / (TAG_RESULTS_END - TAG_TYPING_ENDS)
  const results = Math.max(
    0,
    Math.min(
      TAG_MATCHES.length,
      Math.floor(searching * TAG_MATCHES.length) + (searching > 0 ? 1 : 0),
    ),
  )

  const picked = p >= TAG_PICK
  const artwork = picked ? Math.min(1, (p - TAG_PICK) / 0.14) : 0

  // One field, rewritten in place: the junk name deletes itself and the real one is
  // typed over it, which is what the app does to the field.
  const rewriting = picked ? (p - TAG_PICK - 0.04) / 0.26 : -1
  const artist =
    rewriting < 0
      ? TAG_JUNK_ARTIST
      : rewriting < 0.45
        ? TAG_JUNK_ARTIST.slice(0, Math.ceil((1 - rewriting / 0.45) * TAG_JUNK_ARTIST.length))
        : TAG_ARTIST.slice(
            0,
            Math.round(Math.min(1, (rewriting - 0.45) / 0.55) * TAG_ARTIST.length),
          )

  return {
    query: TAG_QUERY.slice(0, Math.min(TAG_QUERY.length, typed)),
    results,
    open: p >= TAG_OPEN,
    picked,
    artwork,
    artist,
    fields: TAG_FIELDS.map((v, i) => (picked && p > TAG_PICK + 0.3 + i * 0.07 ? v : '')),
  }
}

/* ---------------------------------------------------------------- 03 · quality */

// Where the fake's codec wall sits, as a fraction of the image height from the top:
// the 16 kHz edge on a linear scale. The scan has to travel past it before the verdict
// can appear, because that edge is the evidence for the verdict.
export const SPECTRUM_WALL = 0.273

const QUALITY_POINT = 0.12
const QUALITY_SWITCH = 0.3
const QUALITY_SCAN_ENDS = 0.78

export interface QualityFrame {
  selected: 'genuine' | 'fake'
  cursor: boolean
  scan: number
  wall: number
  verdict: 'good' | 'analyzing' | 'bad'
}

// Two FLACs in the list, as the app shows them: the genuine one selected with its good
// verdict, then a click on the other, whose spectrum is scanned until the codec wall
// shows and the verdict turns.
export function qualityFrame(t: number): QualityFrame {
  const p = clamp(t)
  const fake = p >= QUALITY_SWITCH
  const scan = fake ? clamp((p - QUALITY_SWITCH) / (QUALITY_SCAN_ENDS - QUALITY_SWITCH)) : 0
  return {
    selected: fake ? 'fake' : 'genuine',
    cursor: p >= QUALITY_POINT && p < QUALITY_SWITCH + 0.06,
    scan,
    wall: clamp((scan - SPECTRUM_WALL) / 0.18),
    verdict: !fake ? 'good' : scan < 1 ? 'analyzing' : 'bad',
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

/* --------------------------------------------------------------- 08 · replace */

// Crate names a DJ would recognise as their own. Ten of them, because the scene is
// about the job of re-adding one track to every crate by hand, and one or two crates
// would make that job look like nothing.
export const REPLACE_PLAYLISTS = [
  'Warm up',
  'Peak time',
  'Italo',
  'Progressive',
  'Closing',
  'Afterhours',
  'Classics',
  'Vinyl rips',
  'Favourites',
  'Room 2',
] as const
export const REPLACE_CUES = 15

// The scene's clock in seconds: the conversion is compressed into a few of them, and
// the rest is rekordbox and the crates, where the argument is.
export const REPLACE_SECONDS = 10

export type ReplaceStage = 'idle' | 'converting' | 'appleMusic' | 'done'

export interface ReplaceFrame {
  cursor: 'button' | 'rest' | 'activity' | 'hidden'
  pressed: boolean
  stage: ReplaceStage
  progress: number
  activity: 'hidden' | 'running' | 'done'
  activityOpen: boolean
  repointed: boolean
  playlistsConfirmed: number
  stats: boolean
  saved: boolean
}

// The same steps the app runs, in its order: the press, "Converting to AIFF…" filling
// the button to the app's own stage marks (20 and 55), "Adding to Apple Music…" at 85,
// the converted footer, and only then the rekordbox write reported in Activity.
export function replaceFrame(t: number): ReplaceFrame {
  const s = clamp(t) * REPLACE_SECONDS
  const stage: ReplaceStage =
    s < 1.5 ? 'idle' : s < 3.1 ? 'converting' : s < 4.4 ? 'appleMusic' : 'done'
  const progress = stage === 'idle' || stage === 'done' ? 0 : s < 2.2 ? 20 : s < 3.1 ? 55 : 85
  const confirming = clamp((s - 7.2) / 1.2)
  return {
    cursor: s < 0.2 || s >= 6.2 ? 'hidden' : s < 1.6 ? 'button' : s < 5 ? 'rest' : 'activity',
    pressed: s >= 1.25 && s < 1.45,
    stage,
    progress,
    activity: s < 4.6 ? 'hidden' : s < 6.6 ? 'running' : 'done',
    activityOpen: s >= 5.8,
    repointed: s >= 6.8,
    playlistsConfirmed: Math.floor(confirming * REPLACE_PLAYLISTS.length),
    stats: s >= 8.6,
    saved: s >= 9,
  }
}
