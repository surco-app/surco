// The walkthrough scenes as pure functions of progress (0→1). Each one is frozen
// mid-action in the static version — "12/40", "Converting 11/40", the cut already
// placed — so they show the result of something the visitor never sees happen.
// Keeping the state in one frame function per scene means replay, the end state and
// the reduced-motion jump are all the same code path with a different t.

import { CRATE } from './crate'

const clamp = (t: number) => Math.min(Math.max(t, 0), 1)

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

/* ------------------------------------------------------------------ 07 · batch */

export const BATCH_QUEUE = [
  CRATE.sash,
  CRATE.milk,
  CRATE.sylver,
  CRATE.lasgo,
  CRATE.ivd,
  CRATE.tukan,
  CRATE.bullet,
] as const

export const BATCH_TOTAL = 40

const BATCH_PRESS = 0.12
const BATCH_START = 0.16
const BATCH_ENDS = 0.9

export type BatchState = 'idle' | 'working' | 'done'

export interface BatchFrame {
  cursor: boolean
  pressed: boolean
  states: BatchState[]
  rowProgress: number
  done: number
  finished: boolean
}

// The whole selection converted with one press: each row's ring turns in order while
// the toolbar counts, and the footer reports the tracks in Apple Music once all are.
export function batchFrame(t: number): BatchFrame {
  const p = clamp(t)
  const run = clamp((p - BATCH_START) / (BATCH_ENDS - BATCH_START))
  const pos = run * BATCH_QUEUE.length
  return {
    cursor: p >= 0.03 && p < BATCH_START + 0.03,
    pressed: p >= BATCH_PRESS && p < BATCH_START,
    // >= on the upper bound, or the last track sits at "working" forever once the run
    // completes and the queue ends mid-convert with nothing left to convert.
    states: BATCH_QUEUE.map((_, i) => (pos >= i + 1 ? 'done' : pos > i ? 'working' : 'idle')),
    rowProgress: pos % 1,
    done: Math.round(run * BATCH_TOTAL),
    finished: run >= 1,
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

/* ---------------------------------------------------------------- 09 · review */

export const REVIEW_ROWS = 6
export const REVIEW_TRACKS = 2
export const REVIEW_APPLY_BEFORE = 2
export const REVIEW_APPLY_AFTER = 3
export const REVIEW_SECONDS = 9

export interface ReviewFrame {
  rows: number
  cursor: 'group' | 'option' | 'apply' | 'hidden'
  selected: boolean
  picked: boolean
  resolved: number
  applyCount: number
  pressed: boolean
  applying: boolean
  applied: boolean
}

export function reviewFrame(t: number): ReviewFrame {
  const s = clamp(t) * REVIEW_SECONDS
  return {
    rows: Math.floor(clamp((s - 0.2) / 1.2) * REVIEW_ROWS),
    cursor: s < 1.6 || s >= 6.6 ? 'hidden' : s < 2.9 ? 'group' : s < 5.2 ? 'option' : 'apply',
    selected: s >= 2.3,
    picked: s >= 3.7,
    resolved: Math.floor(clamp((s - 4.1) / 0.6) * REVIEW_TRACKS),
    applyCount: s >= 5 ? REVIEW_APPLY_AFTER : REVIEW_APPLY_BEFORE,
    pressed: s >= 6 && s < 6.2,
    applying: s >= 6.2 && s < 6.9,
    applied: s >= 6.9,
  }
}

export const CUES_BARS = 207
export const CUES_POINTS = [71, 149] as const
export const CUES_HOVERS = [[59, 65, 71]] as const
export const CUES_ZOOM = { from: 19, span: 134, bars: 56, views: [19, 97] } as const
export const CUES_SECONDS = 15
export const CUES_CALL_COLOUR = '#e62828'

export const CUES_FLOW = [
  { back: 48, colour: '#e62828' },
  { back: 32, colour: '#28e214' },
  { back: 16, colour: '#305aff' },
] as const

const CUES_LETTERS = 'ABCDEFGH'

export interface CueMark {
  bar: number
  letter: string
  colour: string
}

export interface CuePlacement {
  points: number[]
  hot: CueMark[]
}

export interface CuesFrame {
  view: 0 | 1
  cursor: 'hidden' | 'start' | 'closer' | 'point' | 'auto' | 'save'
  ghost: CuePlacement | null
  pressed: boolean
  autoPressed: boolean
  proposal: CuePlacement | null
  returnPressed: boolean
  placed: CuePlacement
  savePressed: boolean
  saved: boolean
}

const placement = (point: number, before: number): CuePlacement => ({
  points: [point],
  hot: CUES_FLOW.map(({ back, colour }, i) => ({
    bar: point - back,
    letter: CUES_LETTERS[before + i],
    colour,
  })),
})

export function cuesFrame(t: number): CuesFrame {
  const s = clamp(t) * CUES_SECONDS
  const first = placement(CUES_POINTS[0], 0)
  const second = placement(CUES_POINTS[1], CUES_FLOW.length)
  const placed = [...(s >= 5.1 ? [first] : []), ...(s >= 10.9 ? [second] : [])]
  const hover = CUES_HOVERS[0][s < 3 ? 0 : s < 4.4 ? 1 : 2]
  return {
    view: s >= 5.6 ? 1 : 0,
    cursor:
      s >= 11.9
        ? s < 13.9
          ? 'save'
          : 'hidden'
        : s >= 6.8 && s < 8.7
          ? 'auto'
          : s < 0.5 || s >= 5.5
            ? 'hidden'
            : s < 2.2
              ? 'start'
              : s < 3.6
                ? 'closer'
                : 'point',
    ghost: s >= 1.3 && s < 5.1 ? placement(hover, 0) : null,
    pressed: s >= 4.9 && s < 5.1,
    autoPressed: s >= 7.9 && s < 8.1,
    proposal: s >= 8.4 && s < 10.9 ? second : null,
    returnPressed: s >= 10.3 && s < 10.9,
    placed: {
      points: placed.flatMap((p) => p.points),
      hot: placed.flatMap((p) => p.hot),
    },
    savePressed: s >= 13 && s < 13.2,
    saved: s >= 13.2,
  }
}

export const GRID_TRACK = CRATE.sash
export const GRID_BEAT_MS = 60000 / 136
export const GRID_DRIFT_MS = -11
export const GRID_WINDOW = { from: -70, to: 50 } as const
export const GRID_COUNT = 12
export const GRID_SECONDS = 7

const GRID_COLUMNS = 60
const GRID_JITTER = [0.82, 1, 0.9, 0.76, 0.95, 0.86, 1, 0.8, 0.92, 0.88]

export const GRID_ENVELOPE = Array.from({ length: GRID_COLUMNS }, (_, i) => {
  const ms = GRID_WINDOW.from + ((i + 0.5) / GRID_COLUMNS) * (GRID_WINDOW.to - GRID_WINDOW.from)
  const jitter = GRID_JITTER[i % GRID_JITTER.length]
  const level = ms < 0 ? 0.1 : 0.35 + 0.6 * Math.exp(-ms / 40)
  return Math.round(level * jitter * 100) / 100
})

export interface GridFrame {
  selected: boolean
  count: number
  clearPressed: boolean
  autoPressed: boolean
  cueMs: number | null
}

export function gridFrame(t: number): GridFrame {
  const s = clamp(t) * GRID_SECONDS
  return {
    selected: s >= 1,
    count: s >= 5.2 ? GRID_COUNT - 1 : GRID_COUNT,
    clearPressed: s >= 2.6 && s < 2.8,
    autoPressed: s >= 3.8 && s < 4,
    cueMs: s < 2.8 ? GRID_DRIFT_MS : s < 4.4 ? null : 0,
  }
}

/* ---------------------------------------------------------------- 10 · sync */

export interface SyncValues {
  title: string
  genre: string
  file: string
}

export const SYNC_LIBRARIES = ['Apple Music', 'rekordbox', 'Traktor', 'Engine DJ'] as const

export const SYNC_START: SyncValues = {
  title: 'The Sun Always Shines (orig ext)',
  genre: 'Electronic',
  file: '07 sun always shines.mp3',
}

export const SYNC_ACT1: SyncValues = {
  title: 'The Sun Always Shines On TV (Original Extended)',
  genre: 'Electronic',
  file: 'Milk Inc. - The Sun Always Shines On TV (Original Extended).mp3',
}

export const SYNC_ACT2: SyncValues = { ...SYNC_ACT1, genre: 'Trance' }

export const SYNC_SECONDS = 15

export interface SyncFrame {
  origin: 'appleMusic' | 'rekordbox'
  fields: SyncValues
  typing: keyof SyncValues | null
  pressed: boolean
  saved: boolean
  updated: number
  libraries: SyncValues[]
}

const typed = (from: string, to: string, start: number, end: number, s: number): string =>
  s < start ? from : to.slice(0, Math.ceil(clamp((s - start) / (end - start)) * to.length))

const LIBRARY_GAP = 0.45

// The edit happens in Surco on a track opened from one program's tab, and reaches every
// program only once Update is pressed, one after another as each library is written.
export function syncFrame(t: number): SyncFrame {
  const s = clamp(t) * SYNC_SECONDS
  const second = s >= 7.5
  const from = second ? SYNC_ACT1 : SYNC_START
  const to = second ? SYNC_ACT2 : SYNC_ACT1
  const at = second ? s - 7.5 : s
  const fields: SyncValues = second
    ? { ...from, genre: typed(from.genre, to.genre, 0.8, 1.5, at) }
    : {
        ...from,
        title: typed(from.title, to.title, 0.8, 2.4, at),
        file: typed(from.file, to.file, 2.6, 3.8, at),
      }
  const typing: SyncFrame['typing'] = second
    ? at >= 0.8 && at < 1.5
      ? 'genre'
      : null
    : at >= 0.8 && at < 2.4
      ? 'title'
      : at >= 2.6 && at < 3.8
        ? 'file'
        : null
  const pressAt = second ? 2 : 4.2
  const updated = SYNC_LIBRARIES.filter((_, i) => at >= pressAt + 0.6 + i * LIBRARY_GAP).length
  return {
    origin: second ? 'rekordbox' : 'appleMusic',
    fields,
    typing,
    pressed: at >= pressAt && at < pressAt + 0.2,
    saved: at >= pressAt + 0.2,
    updated,
    libraries: SYNC_LIBRARIES.map((_, i) => (i < updated ? to : from)),
  }
}

/* ---------------------------------------------------------------- 11 · matching */

export const MATCHING_CHAINS = [
  ['sash', 'milk', 'sylver'],
  ['lasgo', 'ivd'],
] as const

export const MATCHING_SECONDS = 10

export interface MatchingFrame {
  shown: number
  pressed: boolean
  added: number
}

const MATCHING_ROW_GAP = 0.35
const MATCHING_PRESS = 3.2
const MATCHING_ADD_GAP = 0.4

export function matchingFrame(t: number): MatchingFrame {
  const s = clamp(t) * MATCHING_SECONDS
  const tracks = MATCHING_CHAINS.flat().length
  const count = (start: number, gap: number): number =>
    s < start ? 0 : Math.min(tracks, Math.floor((s - start) / gap) + 1)
  return {
    shown: count(0.6, MATCHING_ROW_GAP),
    pressed: s >= MATCHING_PRESS && s < MATCHING_PRESS + 0.2,
    added: count(MATCHING_PRESS + 0.6, MATCHING_ADD_GAP),
  }
}
