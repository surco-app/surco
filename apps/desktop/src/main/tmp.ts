import { randomUUID } from 'node:crypto'

// A collision-free temp filename. Date.now() repeats when two operations run in
// the same millisecond (addPaths extracts several covers in parallel), so they
// fought over one path; a UUID gives each call its own. Bare name, no directory:
// callers join it onto tmpdir() — analyzeCutoff needs the bare form for ffmpeg's
// filtergraph parser.
export function tmpName(prefix: string, ext: string): string {
  return `surco-${prefix}-${randomUUID()}.${ext}`
}
