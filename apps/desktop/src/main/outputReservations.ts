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

export function createOutputReservations(): OutputReservations {
  const counts = new Map<string, number>()
  return {
    isReserved: (path) => (counts.get(path) ?? 0) > 0,
    reserve: (path) => counts.set(path, (counts.get(path) ?? 0) + 1),
    release: (path) => {
      const next = (counts.get(path) ?? 0) - 1
      if (next <= 0) counts.delete(path)
      else counts.set(path, next)
    },
  }
}
