// Local audio is streamed to the renderer through a custom `surco://` scheme
// rather than read into memory: a privileged streaming protocol gives the
// <audio> element range requests (so seeking works) without buffering a 50 MB+
// file through IPC, and without relaxing webSecurity. The entire absolute path —
// Windows drive letters, backslashes, spaces and accents included — is packed
// into a single percent-encoded URL segment so the same string round-trips on
// macOS and Windows, where a naive `file://` + path concatenation would not.
export const MEDIA_SCHEME = 'surco'
const HOST = 'media'

// The whole absolute path — Windows drive letters, backslashes, spaces and
// accents included — is packed into a single percent-encoded URL segment so the
// same string round-trips on macOS and Windows, where a naive `file://` + path
// concatenation would not.
export function mediaUrl(path: string): string {
  return `${MEDIA_SCHEME}://${HOST}/${encodeURIComponent(path)}`
}

export function mediaPathFromUrl(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''))
}

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
}

// A correct Content-Type matters: without it the <audio> element may refuse to
// decode (and seek) a stream it can't sniff.
export function mediaMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}

// Parses an HTTP Range header into clamped byte bounds, or null when it's absent
// or unsatisfiable (the caller then serves the whole file). Supports `bytes=N-`,
// `bytes=N-M` and the `bytes=-N` suffix form the media element uses to seek.
export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, rawStart, rawEnd] = m
  let start: number
  let end: number
  if (rawStart === '') {
    if (rawEnd === '') return null
    start = Math.max(0, size - Number(rawEnd))
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }
  if (start > end || start >= size) return null
  return { start, end }
}
