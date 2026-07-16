import { createRateLimiter } from '../shared/rateLimiter'

// Discogs allows ~60 requests/min per token, and a burst earns a 429. Every Discogs call
// (search candidates, release fetches, hover prefetch) goes through a shared bucket so they
// can't collectively burst past the cap. A small burst keeps a single interactive search
// instant; the sustained rate stays under the cap for headroom. Lives in its own module so
// the discogs client owns its pacing while unit tests can mock it to run without real timers.
//
// Two buckets, chosen by whether the request carries the user's own token:
//   · The shared app key's 60/min is split across EVERY Surco user at once, so its bucket
//     stays conservative (≈50/min) — pacing it near the ceiling would earn collective 429s
//     the moment a few users sweep at the same time.
//   · A user's own token gets its own private 60/min from Discogs, so it rides a faster
//     bucket (≈54/min): that user can crawl a crate quicker without touching anyone else's
//     quota. The window stays ~10% under 60 so a clock skew or a retry can't tip it over.
const SHARED_BURST = 5
const SHARED_WINDOW_MS = 6000 // 5 tokens / 6s ≈ 50 requests/min sustained
const USER_BURST = 6
const USER_WINDOW_MS = 6600 // 6 tokens / 6.6s ≈ 54 requests/min sustained

const sharedKeyLimiter = createRateLimiter(SHARED_BURST, SHARED_WINDOW_MS)
const userTokenLimiter = createRateLimiter(USER_BURST, USER_WINDOW_MS)

// The bucket a request paces against: the faster private one when the user set their own
// token, the conservative shared one otherwise. Called at every acquire site so a probe's
// search and release loads all pace against the same bucket the token maps to.
export function discogsLimiterFor(token: string): ReturnType<typeof createRateLimiter> {
  return token ? userTokenLimiter : sharedKeyLimiter
}
