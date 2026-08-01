// The Velocidad section as a pure function of elapsed simulated seconds. Keeping the
// state in one `raceFrame(t)` is what makes replay, the final frame and the
// reduced-motion jump the same code path: each is just a different t.

export const TRACKS = 40

// Nobody prepares 40 tracks by running all five steps forty times: you convert the
// whole folder in one go and drag the whole folder into Music at the end. Only the
// steps with a human in them repeat per track. Multiplying the batch steps by 40 is
// what put an earlier version of this section at three hours — a figure any DJ who
// has done the work would read as inflated, which costs the credibility Surco's own
// measured number depends on.
// Timings from the person who actually does this work, not a guess: about five
// minutes per track. The step an outside estimate misses is the second pass of
// tagging — Apple Music does not keep everything the file arrived with, so the
// metadata gets written once in the tag editor and again inside Music, with the
// cover art dragged in by hand on top. That alone is more than two minutes a track.
export const MANUAL_STEPS = [
  { key: 'convert', seconds: 20, per: 'batch' },
  { key: 'discogs', seconds: 60, per: 'track' },
  { key: 'metadata', seconds: 50, per: 'track' },
  { key: 'import', seconds: 15, per: 'batch' },
  { key: 'retag', seconds: 90, per: 'track' },
  { key: 'cover', seconds: 45, per: 'track' },
] as const satisfies readonly { key: string; seconds: number; per: 'track' | 'batch' }[]

const PER_TRACK = MANUAL_STEPS.filter((s) => s.per === 'track')
const MANUAL_PER_TRACK = PER_TRACK.reduce((sum, s) => sum + s.seconds, 0)
const MANUAL_BATCH = MANUAL_STEPS.filter((s) => s.per === 'batch').reduce(
  (sum, s) => sum + s.seconds,
  0,
)

// Cumulative boundaries across the repeating steps only, so the highlight can walk
// them without the batch steps taking a turn they never take in real life.
const BOUNDS = PER_TRACK.reduce<number[]>((acc, s) => {
  acc.push((acc.at(-1) ?? 0) + s.seconds)
  return acc
}, [])

// t spans the repeating work; the batch steps bracket it and are added once.
export const RACE_END = MANUAL_PER_TRACK * TRACKS

// Measured 2026-07-31 in the built app, not with ffmpeg on its own: 40 copies of a
// 7:08 WAV (16/44.1) fed in as if from Finder, select-all, click Convert, clock
// stopped when all 40 AIFFs were on disk. Three runs: 7.0 / 7.7 / 6.7s on a 14-core
// Mac. This is convert + tag, which is what that button does — its stages are
// cover → converting → library add. The audio analysis (spectrum, loudness, BPM,
// key) is a separate background sweep that runs while you are already working the
// list, so it is not time anyone sits and waits through.
export const SURCO_TOTAL = 7.1

// Surco's real minute is a fraction of the manual job, so on a single shared scale
// its bar would be over in a blink and the comparison would be a blur. The fast lane
// runs on its own clock, finishing a fifth of the way in and then sitting there,
// done, while the slow lane grinds on — that wait is the argument the section makes,
// so it has to be visible rather than instant.
const SURCO_SPAN = 0.2

export interface RaceFrame {
  manualDone: number
  surcoDone: number
  manualSeconds: number
  surcoSeconds: number
  activeStep: number | null
  doneSteps: boolean[]
}

export function raceFrame(t: number): RaceFrame {
  // Clamped once here so every derived value is safe: the reduced-motion path and a
  // replay both call this with the end value, and a rAF can overshoot it by a frame.
  const clamped = Math.min(Math.max(t, 0), RACE_END)
  const manualTracks = Math.min(TRACKS, clamped / MANUAL_PER_TRACK)
  const manualDone = Math.floor(manualTracks)
  const finished = manualDone >= TRACKS

  const inTrack = clamped % MANUAL_PER_TRACK
  let activeRepeat = -1
  for (let i = 0; i < BOUNDS.length; i++) {
    if (inTrack < BOUNDS[i]) {
      activeRepeat = i
      break
    }
  }

  let repeatIndex = 0
  let activeStep: number | null = null
  const doneSteps = MANUAL_STEPS.map((step, i) => {
    if (step.per === 'batch') {
      // Convert runs before the per-track grind, import after it.
      return i === 0 ? clamped > 0 : finished
    }
    const done = finished || inTrack >= BOUNDS[repeatIndex]
    if (!finished && repeatIndex === activeRepeat) activeStep = i
    repeatIndex++
    return done
  })

  const surcoProgress = Math.min(1, clamped / (RACE_END * SURCO_SPAN))

  return {
    manualDone,
    surcoDone: Math.round(surcoProgress * TRACKS),
    manualSeconds: Math.min(clamped, RACE_END) + MANUAL_BATCH,
    surcoSeconds: surcoProgress * SURCO_TOTAL,
    activeStep,
    doneSteps,
  }
}
