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

// Clock-friendly ruler intervals: the steps a DJ reads without arithmetic. The
// sub-second entries exist for the ×256 deep zoom, where whole seconds are wider
// than the panel.
const TICK_STEPS_SEC = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

// The zoomed waveform strip's ruler: tick positions (as a percent of the whole
// strip, so they ride the zoomed width) with m:ss labels (m:ss.t under a second).
// The step follows the visible window — durationSec / zoom ≈ what fits in the
// panel — aiming for a tick every ~eighth of it, snapped up to the next
// clock-friendly interval so labels stay sparse enough to read. Edges are
// skipped: 0:00 and the end would crowd the strip's corners with what the player
// readout already says.
export function timeTicks(
  durationSec: number,
  zoom: number,
): { sec: number; pct: number; label: string }[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return []
  const target = durationSec / zoom / 8
  const step = TICK_STEPS_SEC.find((s) => s >= target) ?? TICK_STEPS_SEC[TICK_STEPS_SEC.length - 1]
  const ticks: { sec: number; pct: number; label: string }[] = []
  // Ticks come from an integer index (never `sec += step`): a tenth is not exact
  // in floats, and the drift would land late ticks visibly off their seconds.
  for (let i = 1; ; i++) {
    const sec = Number((i * step).toFixed(3))
    if (sec >= durationSec) break
    const label =
      step < 1 ? `${formatTime(sec)}.${Math.round((sec % 1) * 10) % 10}` : formatTime(sec)
    ticks.push({ sec, pct: (sec / durationSec) * 100, label })
  }
  return ticks
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
