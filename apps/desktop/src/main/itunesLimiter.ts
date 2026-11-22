import { createRateLimiter } from '../shared/rateLimiter'

const ITUNES_BURST = 3
const ITUNES_WINDOW_MS = 9000

export const itunesLimiter = createRateLimiter(ITUNES_BURST, ITUNES_WINDOW_MS)
