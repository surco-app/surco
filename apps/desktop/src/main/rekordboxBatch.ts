// Accumulates the repoints a conversion run produces, so a batch of 300 tracks writes
// the collection once instead of 300 times — one backup, one open, one decision about
// whether rekordbox is running. Mirrors nmlBatch.ts, whose shape was already paid for on
// the Traktor side.

export interface RekordboxRepoint {
  from: string
  to: string
}

let repoints: RekordboxRepoint[] = []

// The renderer's begin/end calls are not guaranteed to nest cleanly: a whole-library run
// opens one pair around everything, while converting a single track opens its own, and
// nothing stops the second happening inside the first. So the accumulator owns
// correctness rather than trusting its callers — it resets only on the outermost begin
// and hands the pool back only on the outermost end.
let depth = 0

export function recordRekordboxRepoint(repoint: RekordboxRepoint): void {
  // A conversion that lands on the path it started from tells rekordbox nothing new, and
  // recording it would make the flush open and back up the collection for nothing.
  if (repoint.from === repoint.to) return
  // Converting one track twice in a run — a retry, an edit followed by a convert — must
  // leave the collection on the last file produced, so the later repoint replaces the
  // earlier one rather than queueing behind it.
  const existing = repoints.findIndex((r) => r.from === repoint.from)
  if (existing !== -1) repoints[existing] = repoint
  else repoints.push(repoint)
}

// The renderer can vanish between a begin and its end (a reload, or the crash-and-reload
// this app has seen in the wild). Without a way back, depth would stay above zero and no
// later batch would ever flush: the collection would quietly stop being updated until the
// app restarted. Dropping the in-flight batch loses those repoints — their conversions
// are done and the collection merely misses them, which the user can redo — and returns
// the accumulator to a working state.
export function abandonRekordboxBatch(): void {
  repoints = []
  depth = 0
}

export function beginRekordboxBatch(): void {
  if (depth === 0) repoints = []
  depth += 1
}

// Returns the accumulated repoints once the outermost batch closes; an inner end returns
// empty and leaves the pool for the outer end, so nothing is lost or flushed early.
export function endRekordboxBatch(): RekordboxRepoint[] {
  depth = Math.max(0, depth - 1)
  if (depth > 0) return []
  const result = repoints
  repoints = []
  return result
}
