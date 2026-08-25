// True when an ffmpeg/ffprobe failure is "the file is not at that path" rather than
// anything about the audio. A track moved or renamed in Finder, or replaced by a
// conversion, leaves the app holding a stale path — an ordinary condition, not a
// damaged file, but the child exits non-zero either way and the two are otherwise
// indistinguishable. Matched here so the probes can name the real cause instead of
// telling a DJ their music could not be analysed. Deliberately narrow: a genuinely
// corrupt file keeps its own ffmpeg stderr, which says more in a bug report.
export function isMissingInputError(err: unknown): boolean {
  const stderr = String((err as { stderr?: unknown })?.stderr ?? '')
  return /No such file or directory|ENOENT/.test(stderr)
}
