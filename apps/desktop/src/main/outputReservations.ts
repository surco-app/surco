// A batch converts several tracks concurrently (mapWithConcurrency): two jobs whose
// metadata resolves to the same output name both see existsSync() === false at the
// moment they check the conflict, race convertAudio's write-to-temp-then-rename, and
// the second rename silently overwrites the first — "2 converted" and one file left on
// disk. This in-memory registry closes that window: a path is claimed for the
// lifetime of the job that resolved it, so a second job asking about the same path
// mid-run sees it as taken and goes through the same conflict prompt an on-disk
// collision would trigger, instead of racing the write.
//
// Counted rather than boolean so a job that reserves the same path twice (e.g. a
// retry) doesn't have its own release evict a still-active claim.
export interface OutputReservations {
  isReserved: (path: string) => boolean
  reserve: (path: string) => void
  release: (path: string) => void
}

// Whether the volume folds case, which decides what counts as "the same path". macOS and
// Windows do: there "Artist - Title.aiff" and "artist - title.aiff" are one file, so two
// jobs claiming those two spellings are racing the same destination and the second rename
// would eat the first. inplace.ts states the same rule for files that already exist (it
// compares device+inode, "because a case-only difference (Song.WAV vs song.wav) is one
// file on the case-insensitive macOS/Windows volumes Surco runs on"); a claim cannot ask
// the filesystem, since the file it protects is precisely the one not written yet. Linux
// keeps the two apart, and folding there would invent conflicts between real files.
//
// A parameter rather than a read of process.platform inside the key function so the
// behaviour is testable on either kind of host, not only on whichever one CI happens to
// run — the case-folding tests would otherwise pass on a Mac and vanish on Linux.
function foldsCase(): boolean {
  return process.platform === 'darwin' || process.platform === 'win32'
}

export function createOutputReservations(
  caseInsensitive: boolean = foldsCase(),
): OutputReservations {
  const counts = new Map<string, number>()
  // Only the case is folded, never the shape: no normalisation of separators, `.` or `..`,
  // or Unicode form. Callers hand in paths this same module's reserve() already built from
  // one resolver, so two spellings of one destination differ by case or not at all —
  // guessing at anything more would risk merging two genuinely different claims.
  const key = (path: string): string => (caseInsensitive ? path.toLowerCase() : path)
  return {
    isReserved: (path) => (counts.get(key(path)) ?? 0) > 0,
    reserve: (path) => counts.set(key(path), (counts.get(key(path)) ?? 0) + 1),
    release: (path) => {
      const next = (counts.get(key(path)) ?? 0) - 1
      if (next <= 0) counts.delete(key(path))
      else counts.set(key(path), next)
    },
  }
}
