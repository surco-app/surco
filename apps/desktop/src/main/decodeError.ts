// execFile rejects with the child's entire stdout/stderr attached to the error. For the
// PCM decoders that stdout is tens of MB of raw audio, and the analysis IPC handlers log
// their errors wholesale — serializing one ~64 MB buffer froze the main process (macOS
// beachball), bloated the log with millions of array items, and let unrelated IPC (a
// Discogs search on its AbortSignal.timeout) time out while the loop churned. The slim
// copy keeps what a log line needs — message, exit code, command line, kill state, the
// original stack and the head of stderr (the human-readable ffmpeg diagnosis) — and
// drops the payloads.

const STDERR_KEEP = 2048

interface ChildOutputError extends Error {
  code?: unknown
  cmd?: unknown
  killed?: unknown
  signal?: unknown
  stdout?: unknown
  stderr?: unknown
}

export function slimDecodeError(err: unknown): unknown {
  if (!(err instanceof Error)) return err
  const e = err as ChildOutputError
  if (e.stdout === undefined && e.stderr === undefined) return err
  const slim = new Error(e.message) as ChildOutputError
  slim.stack = e.stack
  slim.code = e.code
  slim.cmd = e.cmd
  slim.killed = e.killed
  slim.signal = e.signal
  slim.stderr = String(e.stderr ?? '').slice(0, STDERR_KEEP)
  return slim
}

// A corrupt file (broken FLAC frame headers) garbles ffmpeg's timestamp accounting, so
// `-t` stops bounding the output and the decode overruns the maxBuffer ceiling — the
// ceilings are sized with headroom over the exact `-t` window, so a healthy file can
// never hit them. Deterministic on every retry, which is what lets callers treat it as
// a permanent "unmeasurable" rather than a transient decode error.
export function isPcmOverrun(err: unknown): boolean {
  return (
    (err as { code?: unknown } | null | undefined)?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
  )
}
