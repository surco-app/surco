// The main process throws where there is no i18next instance to phrase the failure in
// the user's language, and Electron's IPC serializes a rejection down to its message
// alone — `code` and every custom property are dropped on the way to the renderer. So a
// main-side error that wants to be readable stamps a stable key into the message text
// and the renderer resolves it against its own catalogue, the same trick renameRetry's
// FILE_IN_USE_MARKER already uses. Written in Spanish instead, these sentences reached
// every user in every language.
const PREFIX = 'SURCO_ERR:'

// The failures worth naming: each one has a cause the user can act on, and a string
// under `errors.*` in every locale. Anything not listed here keeps its own text —
// ffmpeg's stderr says more in a bug report than a generic "something failed".
// A runtime list, with the type derived from it: the renderer's locale test walks these
// to prove every stamped key has a string in all five catalogues, and a union alone
// cannot be walked.
export const ERROR_KEYS = [
  'fileMissing',
  'coverUrlBlocked',
  'deezerRateLimit',
  'discogsRateLimit',
  'discogsToken',
  'outputPathEscapes',
  'settingsFileNotSurco',
  'appleMusicNoMediaCopy',
  'appleMusicNoMediaCopyKept',
  'appleMusicAddReturnedOld',
  'convertedOutputUnreadable',
  'convertedOutputTruncated',
  'engineDjOpen',
  'sourceTagsUnread',
  'coverDownloadFailed',
  'coverNotImage',
  'bandcampUnavailable',
  'bandcampPageUnreadable',
  'bandcampUrlBlocked',
  'deezerUnavailable',
  'discogsUnavailable',
  'pathNotAllowed',
  'beatportNotConnected',
  'beatportBadCredentials',
  'beatportUnavailable',
  'beatportRateLimit',
  'beatportTerritoryRestricted',
  'beatportNoSecureStorage',
  'musicbrainzUnavailable',
  'musicbrainzRateLimit',
  'noRoomForBackup',
  'noRoomBeforeMusicRewrite',
  'conversionCancelled',
  'verifyUnknownTrack',
] as const

export type ErrorKey = (typeof ERROR_KEYS)[number]

// Builds the message an ipcMain handler throws. Detail is appended for the log and any
// bug report; the renderer shows the translated string and never this text.
export function errorWithKey(key: ErrorKey, detail?: string): Error {
  return new Error(detail ? `${PREFIX}${key}: ${detail}` : `${PREFIX}${key}`)
}

// Rides the end of a failure's message when the replaced Apple Music entry kept the
// replacing mark in its name: the renderer tells the DJ about the name and still shows the
// real cause, key or text, which the marker never replaces.
export const NAME_LEFT_MARKED = ' SURCO_MUSIC_NAME_LEFT_MARKED'

export function withNameLeftMarked(e: unknown): Error {
  return new Error(`${e instanceof Error ? e.message : String(e)}${NAME_LEFT_MARKED}`)
}

export function splitNameLeftMarked(message: string): { message: string; left: boolean } {
  return message.endsWith(NAME_LEFT_MARKED)
    ? { message: message.slice(0, -NAME_LEFT_MARKED.length), left: true }
    : { message, left: false }
}

// The key a message carries, or null for an ordinary failure. Anchored at the start so
// a path that happens to contain the marker (a file literally named SURCO_ERR:…) can't
// make an unrelated error claim to be a known one.
export function errorKeyOf(message: string): ErrorKey | null {
  if (!message.startsWith(PREFIX)) return null
  const key = message.slice(PREFIX.length).split(':')[0]
  return key ? (key as ErrorKey) : null
}
