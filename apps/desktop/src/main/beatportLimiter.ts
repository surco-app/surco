import { createRateLimiter } from '../shared/rateLimiter'

const BEATPORT_BURST = 10
const BEATPORT_WINDOW_MS = 2000

export const beatportLimiter = createRateLimiter(BEATPORT_BURST, BEATPORT_WINDOW_MS)
