import { createRateLimiter } from '../shared/rateLimiter'

// Discogs allows ~60 requests/min per token, and a burst earns a 429. Every Discogs
// call (search candidates, release fetches, hover prefetch) goes through this one
// shared bucket so they can't collectively burst past the cap. A small burst keeps a
// single interactive search instant; the sustained rate stays under the cap for
// headroom. Lives in its own module so the discogs client owns its pacing while unit
// tests can mock it to run without real timers.
const DISCOGS_BURST = 5
const DISCOGS_WINDOW_MS = 6000 // 5 tokens / 6s ≈ 50 requests/min sustained

export const discogsLimiter = createRateLimiter(DISCOGS_BURST, DISCOGS_WINDOW_MS)
