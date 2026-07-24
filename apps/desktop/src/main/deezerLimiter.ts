import { createRateLimiter } from '../shared/rateLimiter'

// Deezer's public API allows 50 requests per 5 seconds per IP. Half that budget keeps
// Surco a good citizen while a burst still makes an interactive search feel instant.
// Its own module (like the Discogs and Bandcamp ones) so the client owns its pacing
// and tests can mock it to run without real timers.
const DEEZER_BURST = 10
const DEEZER_WINDOW_MS = 2000 // 10 tokens / 2s = 25 req/5s sustained

export const deezerLimiter = createRateLimiter(DEEZER_BURST, DEEZER_WINDOW_MS)
