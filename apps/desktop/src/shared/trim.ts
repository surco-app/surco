// Silence trim ("top and tail") and its one translation into an ffmpeg filter.
// Lives in shared next to declick.ts, which both processes read the same way:
// main builds the conversion filter with it and repairs stored session values,
// the renderer validates what the editor stages.
import type { TrimRange } from './types'

// Long enough to kill the step a cut through low-level surface noise would click
// with, short enough to be inaudible as a fade on the music itself.
const FADE_SEC = 0.02

// Handle drags produce float noise; ffmpeg needs no more than millisecond precision.
function secs(value: number): number {
  return Number(value.toFixed(3))
}

// Repairs any stored value into a usable range: bounds must be finite non-negative
// numbers, a start of zero cuts nothing so it reads as absent, and an end at or
// before the start (which would make atrim emit an empty stream) drops the pair.
// Anything unusable degrades to undefined — "no trim" — never to an error.
export function normalizeTrim(value: unknown): TrimRange | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { startSec, endSec } = value as { startSec?: unknown; endSec?: unknown }
  const trim: TrimRange = {}
  if (typeof startSec === 'number' && Number.isFinite(startSec) && startSec > 0)
    trim.startSec = startSec
  if (typeof endSec === 'number' && Number.isFinite(endSec) && endSec > 0) trim.endSec = endSec
  if (trim.startSec !== undefined && trim.endSec !== undefined && trim.endSec <= trim.startSec)
    return undefined
  return trim.startSec === undefined && trim.endSec === undefined ? undefined : trim
}

// The -af stage for a confirmed trim: an exact atrim on the seconds the user saw
// in the editor (never a runtime silence re-detection, which could cut somewhere
// the preview didn't show), a timestamp reset so the encoder doesn't mux leading
// delay, and a micro-fade on each cut edge — a cut through vinyl surface noise is
// never digital silence, and an abrupt step there clicks.
export function trimFilter(trim: TrimRange | undefined): string | null {
  if (!trim) return null
  const start = trim.startSec !== undefined && trim.startSec > 0 ? secs(trim.startSec) : undefined
  const end = trim.endSec !== undefined ? secs(trim.endSec) : undefined
  if (start === undefined && end === undefined) return null
  const bounds = [
    start !== undefined ? `start=${start}` : undefined,
    end !== undefined ? `end=${end}` : undefined,
  ]
    .filter(Boolean)
    .join(':')
  const stages = [`atrim=${bounds}`, 'asetpts=PTS-STARTPTS']
  if (start !== undefined) stages.push(`afade=t=in:d=${FADE_SEC}`)
  if (end !== undefined) stages.push(`afade=t=out:st=${secs(end - (start ?? 0) - FADE_SEC)}:d=${FADE_SEC}`)
  return stages.join(',')
}
