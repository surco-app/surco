import type { EngineRepoint, EngineShift } from './engineRepoint'

// A file rewritten on its own path outside a conversion: a review's tag write, Music
// retagging its entry's file, an original restored over its replacement. Engine DJ's row
// records the file's size, so it gets the in-place repoint a conversion's flush sends, whose
// write only lands while the row still holds fromBytes, through the queue that waits while
// Engine is open.
export function engineSizeFollower(deps: {
  enabled: () => boolean
  enqueue: (ops: [], repoints: EngineRepoint[]) => void
  apply: () => void
}) {
  return (file: string, fromBytes: number, engineShift?: EngineShift): void => {
    if (!deps.enabled()) return
    deps.enqueue([], [{ from: file, to: file, fromBytes, ...(engineShift ? { engineShift } : {}) }])
    deps.apply()
  }
}
