export type UpdateErrorKind = 'transient' | 'offline' | 'fatal'

export interface UpdateErrorInfo {
  kind: UpdateErrorKind
  status: number | null
}

// No network at all: expected life on a train, never worth a toast. Checked before
// the transient list so an offline DNS failure never lands in the "GitHub is down"
// bucket.
const OFFLINE_CODES = [
  'ENOTFOUND',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_NETWORK_CHANGED',
]

// The connection exists but hiccuped: worth silent retries, worth telling the user
// only if it keeps failing.
const TRANSIENT_CODES = [
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_TIMED_OUT',
]

// The release exists before all its assets do: the workflow creates it up front so
// the four matrix jobs have one release to upload to, and the merged latest-mac.yml
// only lands once the slowest arch finishes signing and notarizing. A machine with
// betaUpdates on (allowPrerelease) sees the prerelease during that window and gets a
// 404 for the feed. electron-updater rewraps that 404 with this code and WITHOUT the
// statusCode, so it has to be matched by code — and it is transient by construction:
// the file appears minutes later on its own.
const CHANNEL_FILE_MISSING = 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'

// Sorts an updater failure into the retry loop (transient/offline) or the
// tell-the-user-now path (fatal). electron-updater's HttpError exposes the response
// as `statusCode`; Node and Chromium network failures only leave a code, either in
// `err.code` or embedded in the message as `net::ERR_*`.
export function classifyUpdateError(err: unknown): UpdateErrorInfo {
  const statusCode = (err as { statusCode?: unknown } | null)?.statusCode
  if (typeof statusCode === 'number') {
    const retryable = statusCode >= 500 || statusCode === 429
    return { kind: retryable ? 'transient' : 'fatal', status: statusCode }
  }
  const code = (err as { code?: unknown } | null)?.code
  const text = `${typeof code === 'string' ? code : ''} ${err instanceof Error ? err.message : String(err)}`
  if (text.includes(CHANNEL_FILE_MISSING)) return { kind: 'transient', status: null }
  if (OFFLINE_CODES.some((c) => text.includes(c))) return { kind: 'offline', status: null }
  if (TRANSIENT_CODES.some((c) => text.includes(c))) return { kind: 'transient', status: null }
  return { kind: 'fatal', status: null }
}

// electron-updater's HttpError message is a multi-line dump (method, URL, HTML body,
// headers). The user only ever sees this first line; the full error goes to main.log.
export function summarizeUpdateError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const line = message.split('\n', 1)[0].trim()
  return line.length > 120 ? `${line.slice(0, 119)}…` : line
}
