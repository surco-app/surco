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
