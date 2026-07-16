// Shared config for the main process's outbound HTTP requests — Discogs search and
// cover downloads — so both identify themselves the same way and neither can leave a
// stalled socket pending forever.
export const USER_AGENT = 'Surco/0.1 +https://github.com/surco-app/surco'
export const REQUEST_TIMEOUT_MS = 10_000
