import type { ReleaseTrack } from '../../../shared/types'
import { parseDuration } from './duration'
import {
  normalize,
  type ScoreWeights,
  scoreTrack,
  type TrackMatchTarget,
  titleSimilarity,
} from './release'

// When matching a whole album at once the title field is often just the release name
// repeated across every file, so it cannot tell the cuts apart — the exact, probed
// duration can. So duration dominates here, unlike the single-track tick (where the
// user is looking at one specific file and its title is meaningful).
const ASSIGN_WEIGHTS: ScoreWeights = { title: 0.25, duration: 0.65, position: 0.05, artist: 0.05 }

// Vinyl rips drift a few seconds and Discogs lists rounded times, so a match never has
// to be exact. But a track whose length is further off than this simply isn't this cut,
// no matter how well the title matches, so it is disqualified — better to leave the file
// unassigned than to stamp it with a clearly-wrong track.
const DURATION_MARGIN_SEC = 20

export interface AssignInput {
  id: string
  target: TrackMatchTarget
}

export interface Assignment {
  id: string
  // Kept so a manual reassignment can re-score the new pairing without the caller
  // having to thread the file's metadata back in.
  target: TrackMatchTarget
  track: ReleaseTrack | undefined
  confidence: number
}

function durationDisqualifies(target: TrackMatchTarget, track: ReleaseTrack): boolean {
  const trackSec = parseDuration(track.duration)
  if (target.durationSec === undefined || trackSec === undefined) return false
  return Math.abs(target.durationSec - trackSec) > DURATION_MARGIN_SEC
}

// A file whose specific title matches neither this cut nor the album name isn't this cut,
// however close the length: a different song of similar duration would otherwise be stamped
// with the release's track (three rips collapsing onto one "Rocket Man" entry was the bug).
// Only applied when the album title is known — and a title that's really just the album name
// repeated across the rip (the album-rip case duration is meant to handle) is exempt, since
// it carries no per-cut signal. Without an album title the old duration-wins behaviour holds.
function titleContradicts(
  target: TrackMatchTarget,
  track: ReleaseTrack,
  albumTitle: string | undefined,
): boolean {
  if (!albumTitle || !normalize(target.title)) return false
  if (titleSimilarity(target.title, albumTitle) > 0) return false
  return titleSimilarity(target.title, track.title) === 0
}

// Matches each dropped file to its best tracklist entry, by duration first and title
// second. Files are scored independently and a track may be picked by more than one
// file on purpose: two copies of the same cut should both land on it, so nothing here
// forces a one-to-one mapping. A file whose length matches no track within the margin
// is left unassigned rather than pushed onto a clearly-wrong entry.
export function assignTracks(
  files: AssignInput[],
  tracklist: ReleaseTrack[],
  albumTitle?: string,
): Assignment[] {
  return files.map((file) => {
    let best: { track: ReleaseTrack; confidence: number } | undefined
    for (const track of tracklist) {
      if (durationDisqualifies(file.target, track)) continue
      if (titleContradicts(file.target, track, albumTitle)) continue
      const confidence = scoreTrack(track, file.target, ASSIGN_WEIGHTS)
      if (confidence > 0 && (!best || confidence > best.confidence)) best = { track, confidence }
    }
    return {
      id: file.id,
      target: file.target,
      track: best?.track,
      confidence: best?.confidence ?? 0,
    }
  })
}

// Manually points a file at a track (or unassigns it with track=undefined). Only that
// file changes — others keep their entry even if it's the same track, since duplicates
// are allowed. Confidence is recomputed so the panel's badge stays honest, auto or hand-picked.
export function reassign(
  assignments: Assignment[],
  fileId: string,
  track: ReleaseTrack | undefined,
): Assignment[] {
  return assignments.map((a) =>
    a.id === fileId
      ? { ...a, track, confidence: track ? scoreTrack(track, a.target, ASSIGN_WEIGHTS) : 0 }
      : a,
  )
}
