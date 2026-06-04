// Formats a number of seconds as m:ss (or h:mm:ss past an hour) for the player's
// elapsed/total readout. A non-finite or negative value — the <audio> duration
// before onLoadedMetadata fires — renders as 0:00 so "NaN:aN" never reaches the UI.
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const ss = String(total % 60).padStart(2, '0')
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
  return `${m}:${ss}`
}

// Parses a Discogs track length ("5:47", or "1:01:01" for a long mix) into
// seconds — the inverse of formatTime — so a release's track length can be
// compared against the file's probed duration. Returns undefined for an absent
// or unparseable value: a missing length must not read as 0 seconds, which would
// score as wildly mismatched against every real file.
export function parseDuration(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parts = value.split(':')
  if (parts.length < 2 || parts.length > 3) return undefined
  let total = 0
  for (const part of parts) {
    if (!/^\d+$/.test(part.trim())) return undefined
    total = total * 60 + Number(part)
  }
  return total
}
