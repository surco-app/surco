import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { IdentifyResult } from '../shared/types'
import { fpcalcPath } from './binaries'

// Audio-fingerprint identification: Chromaprint's `fpcalc` turns the decoded audio
// into a fingerprint, AcoustID maps that fingerprint to a MusicBrainz recording, and
// we surface the best match's title/artist/album. This lets a track with a garbage
// filename (a typical Soulseek rip) be identified by sound so Discogs can then refine
// it. The pure parsing/URL helpers are unit-tested; the exec + fetch wiring below runs
// the real binary and network.

const run = promisify(execFile)

// Surco's AcoustID application API key. Register a free application at
// https://acoustid.org/new-application and paste its API key here; like the Discogs
// app key it ships in the binary and is safe to treat as public. Empty until set,
// which makes identify() fail loudly rather than query AcoustID without one.
const ACOUSTID_CLIENT_KEY = 'EB9AHNCUZ3'

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

export async function computeFingerprint(
  input: string,
): Promise<{ fingerprint: string; duration: number }> {
  try {
    const { stdout } = await run(fpcalcPath, fpcalcArgs(input))
    return parseFpcalc(stdout)
  } catch (err) {
    // ENOENT = fpcalc isn't installed/bundled yet; make that legible to the caller.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error('fpcalc (Chromaprint) is not available')
    throw err
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// AcoustID allows ~3 requests/second; a burst earns a 429 (or a 503 under load), so
// back off and retry a few times before surfacing the limit.
export async function lookupAcoustid(
  fingerprint: string,
  duration: number,
  key: string,
): Promise<IdentifyResult | null> {
  const url = acoustidUrl(fingerprint, duration, key)
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url)
    if (res.status === 429 || res.status === 503) {
      if (attempt >= 3) throw new Error('AcoustID rate limit reached')
      await sleep(1000 * 2 ** attempt)
      continue
    }
    if (!res.ok) throw new Error(`AcoustID returned ${res.status}`)
    return parseAcoustidResponse(await res.json())
  }
}

// Fingerprints the file and asks AcoustID what it is. Returns null when there's no
// confident match; throws (missing key/binary, network) so the UI can tell the user.
export async function identify(input: string): Promise<IdentifyResult | null> {
  if (!ACOUSTID_CLIENT_KEY) throw new Error('AcoustID client key not configured')
  const { fingerprint, duration } = await computeFingerprint(input)
  return lookupAcoustid(fingerprint, duration, ACOUSTID_CLIENT_KEY)
}
