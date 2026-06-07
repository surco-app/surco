import type { IdentifyResult } from '../shared/types'

// Audio-fingerprint identification: Chromaprint's `fpcalc` turns the decoded audio
// into a fingerprint, AcoustID maps that fingerprint to a MusicBrainz recording, and
// we surface the best match's title/artist/album. This lets a track with a garbage
// filename (a typical Soulseek rip) be identified by sound so Discogs can then refine
// it. The exec + fetch wiring lives in fingerprint.exec.ts; the pure parsing/URL logic
// stays here so it can be unit-tested without the binary or the network.

// fpcalc prints a JSON object: { "duration": <seconds>, "fingerprint": "<base64-ish>" }.
export function parseFpcalc(stdout: string): { fingerprint: string; duration: number } {
  const data = JSON.parse(stdout) as { fingerprint?: unknown; duration?: unknown }
  const fingerprint = typeof data.fingerprint === 'string' ? data.fingerprint : ''
  const duration = Number(data.duration)
  if (!fingerprint || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('fpcalc did not return a usable fingerprint')
  }
  return { fingerprint, duration }
}

// 120s is enough audio to fingerprint a track and keeps a long DJ mix from being slow.
export function fpcalcArgs(input: string): string[] {
  return ['-json', '-length', '120', input]
}

const ACOUSTID_LOOKUP = 'https://api.acoustid.org/v2/lookup'

export function acoustidUrl(fingerprint: string, duration: number, key: string): string {
  const params = new URLSearchParams({
    client: key,
    // AcoustID matches against an integer-second duration.
    duration: String(Math.round(duration)),
    fingerprint,
    meta: 'recordings+releasegroups',
  })
  return `${ACOUSTID_LOOKUP}?${params.toString()}`
}

interface AcoustidRecording {
  title?: string
  artists?: { name?: string }[]
  releasegroups?: { title?: string }[]
}
interface AcoustidResult {
  score?: number
  recordings?: AcoustidRecording[]
}
interface AcoustidResponse {
  status?: string
  results?: AcoustidResult[]
}

// Picks the highest-scoring result that actually carries a recording (AcoustID can
// return a confident fingerprint match with no metadata attached) and maps it onto
// our fields. Returns null for an error status or no usable match.
export function parseAcoustidResponse(data: unknown): IdentifyResult | null {
  const body = data as AcoustidResponse
  if (body?.status !== 'ok' || !Array.isArray(body.results)) return null
  const best = body.results
    .filter((r) => Array.isArray(r.recordings) && r.recordings.length > 0)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
  if (!best?.recordings) return null
  const recording = best.recordings[0]
  const artist = (recording.artists ?? [])
    .map((a) => a.name ?? '')
    .filter(Boolean)
    .join(', ')
  return {
    title: recording.title ?? '',
    artist,
    album: recording.releasegroups?.[0]?.title ?? '',
    score: best.score ?? 0,
  }
}
