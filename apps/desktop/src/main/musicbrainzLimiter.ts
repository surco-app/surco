import { createRateLimiter } from '../shared/rateLimiter'

// MusicBrainz allows one request per second per client IP and answers 503 above it; a
// client that keeps going past that gets its IP blocked. A bucket of one, refilled every
// second, never bursts: the rate is the rule, not a budget to spend. Its own module (like
// the other providers') so the client owns its pacing and tests can mock it.
const MUSICBRAINZ_BURST = 1
const MUSICBRAINZ_WINDOW_MS = 1000

export const musicbrainzLimiter = createRateLimiter(MUSICBRAINZ_BURST, MUSICBRAINZ_WINDOW_MS)
