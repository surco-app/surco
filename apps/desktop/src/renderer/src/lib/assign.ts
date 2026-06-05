import type { DiscogsTrack } from '../../../shared/types'
import { scoreTrack, type ScoreWeights, type TrackMatchTarget } from './release'

// When matching a whole album at once the title field is often just the release name
// repeated across every file, so it cannot tell the cuts apart — the exact, probed
// duration can. So duration dominates here, unlike the single-track tick (where the
// user is looking at one specific file and its title is meaningful).
const ASSIGN_WEIGHTS: ScoreWeights = { title: 0.25, duration: 0.65, position: 0.05, artist: 0.05 }

export interface AssignInput {
  id: string
  target: TrackMatchTarget
}

export interface Assignment {
  id: string
  // Kept so a manual reassignment can re-score the new pairing without the caller
  // having to thread the file's metadata back in.
  target: TrackMatchTarget
  track: DiscogsTrack | undefined
  confidence: number
}

// One-to-one matching between dropped files and a release's tracklist. Running
// bestMatch per file independently lets two rips claim the same entry; here every
// track is used at most once. Greedy by descending confidence — for the 4–12 cuts of
// an album this is optimal in practice — and a file with no positive signal is left
// unassigned rather than handed an arbitrary leftover. Duration, already probed
// exactly, is what separates cuts of the same record, so it drives most pairings.
export function assignTracks(files: AssignInput[], tracklist: DiscogsTrack[]): Assignment[] {
  const edges: { fileIdx: number; trackIdx: number; confidence: number }[] = []
  files.forEach((file, fileIdx) => {
    tracklist.forEach((track, trackIdx) => {
      const confidence = scoreTrack(track, file.target, ASSIGN_WEIGHTS)
      if (confidence > 0) edges.push({ fileIdx, trackIdx, confidence })
    })
  })
  edges.sort((a, b) => b.confidence - a.confidence)

  const result: Assignment[] = files.map((f) => ({
    id: f.id,
    target: f.target,
    track: undefined,
    confidence: 0,
  }))
  const takenFile = new Set<number>()
  const takenTrack = new Set<number>()
  for (const edge of edges) {
    if (takenFile.has(edge.fileIdx) || takenTrack.has(edge.trackIdx)) continue
    takenFile.add(edge.fileIdx)
    takenTrack.add(edge.trackIdx)
    result[edge.fileIdx] = {
      ...result[edge.fileIdx],
      track: tracklist[edge.trackIdx],
      confidence: edge.confidence,
    }
  }
  return result
}

// Manually points a file at a track while keeping the matching one-to-one: if another
// file already held that track, the two swap entries so no track is ever shared.
// Passing track=undefined just unassigns the file. Confidence is recomputed for the
// new pairings so the panel's badge keeps telling the truth, auto or hand-picked.
export function reassign(
  assignments: Assignment[],
  fileId: string,
  track: DiscogsTrack | undefined,
): Assignment[] {
  const me = assignments.find((a) => a.id === fileId)
  if (!me) return assignments
  const freed = me.track
  const holder = track ? assignments.find((a) => a.id !== fileId && a.track === track) : undefined
  return assignments.map((a) => {
    if (a.id === fileId) {
      return { ...a, track, confidence: track ? scoreTrack(track, a.target, ASSIGN_WEIGHTS) : 0 }
    }
    if (holder && a.id === holder.id) {
      return { ...a, track: freed, confidence: freed ? scoreTrack(freed, a.target, ASSIGN_WEIGHTS) : 0 }
    }
    return a
  })
}
