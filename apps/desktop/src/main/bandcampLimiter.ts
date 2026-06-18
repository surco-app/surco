import { createRateLimiter } from '../shared/rateLimiter'

// Bandcamp publishes no public search API and so no documented rate limit; the
// autocomplete and page fetches here ride an unofficial endpoint. Pace every call
// through one shared bucket — gently, to stay a good citizen and avoid tripping any
// hidden throttle — while a small burst keeps a single interactive search instant.
// Its own module (like the Discogs one) so the client owns its pacing and tests can
// mock it to run without real timers.
const BANDCAMP_BURST = 5
const BANDCAMP_WINDOW_MS = 6000 // 5 tokens / 6s ≈ 50 requests/min sustained

export const bandcampLimiter = createRateLimiter(BANDCAMP_BURST, BANDCAMP_WINDOW_MS)
