import { BEATS_PER_BAR, nearestBeat, SAME_POSITION_MS } from '../../../shared/cueRules'

const ZOOM_BARS = [4, 8, 16, 32, 64] as const
export const DEFAULT_ZOOM_BARS = 16

export function jumpBeats(beats: number[], ms: number, count: number): number {
  if (beats.length === 0) return ms
  const from = nearestBeat(beats, ms)
  const to = from + count
  if (to < 0) return 0
  if (to >= beats.length) return Math.max(ms, beats[beats.length - 1])
  return Math.max(0, beats[to] + ms - beats[from])
}

export function snapToBeat(beats: number[], ms: number): number {
  return beats.length === 0 ? ms : beats[nearestBeat(beats, ms)]
}

export function adjacentCall(
  cues: { ms: number; kind: number }[],
  ms: number,
  dir: 1 | -1,
): number | null {
  const ahead = cues
    .filter((c) => c.kind === 0)
    .map((c) => c.ms)
    .filter((at) => (dir === 1 ? at > ms + SAME_POSITION_MS : at < ms - SAME_POSITION_MS))
  if (ahead.length === 0) return null
  return dir === 1 ? Math.min(...ahead) : Math.max(...ahead)
}

export function callAt<T extends { ms: number; kind: number }>(
  cues: T[],
  ms: number,
): T | undefined {
  return cues.find((c) => c.kind === 0 && Math.abs(c.ms - ms) <= SAME_POSITION_MS)
}

function beatPosition(beats: number[], ms: number): number {
  if (ms <= beats[0]) return 0
  let i = 0
  while (i + 1 < beats.length && beats[i + 1] <= ms) i++
  if (i + 1 >= beats.length) return i
  return i + (ms - beats[i]) / (beats[i + 1] - beats[i])
}

export function barsToNextCall(beats: number[], points: number[], ms: number): number | null {
  if (beats.length === 0) return null
  const ahead = points.filter((p) => p >= ms - SAME_POSITION_MS)
  if (ahead.length === 0) return null
  const next = Math.min(...ahead)
  if (Math.abs(next - ms) <= SAME_POSITION_MS) return 0
  return Math.max(0, (beatPosition(beats, next) - beatPosition(beats, ms)) / BEATS_PER_BAR)
}

export function wholeBars(bars: number): number {
  return Math.max(0, Math.ceil(bars - 1e-6))
}

export function zoomStep(bars: number, dir: 'in' | 'out'): number {
  const found = (ZOOM_BARS as readonly number[]).indexOf(bars)
  const at = found === -1 ? ZOOM_BARS.indexOf(DEFAULT_ZOOM_BARS) : found
  const next = Math.min(ZOOM_BARS.length - 1, Math.max(0, at + (dir === 'in' ? -1 : 1)))
  return ZOOM_BARS[next]
}

export function detailWindow(
  beats: number[],
  ms: number,
  bars: number,
): { fromMs: number; toMs: number } {
  const j = Math.max(1, Math.min(nearestBeat(beats, ms) + 1, beats.length - 1))
  const beatMs = beats[j] - beats[j - 1] || 500
  const half = (bars * BEATS_PER_BAR * beatMs) / 2
  return { fromMs: ms - half, toMs: ms + half }
}

export function cueClock(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100)
  const minutes = Math.floor(tenths / 600)
  const seconds = String(Math.floor((tenths % 600) / 10)).padStart(2, '0')
  return `${minutes}:${seconds}.${tenths % 10}`
}

export const WHEEL_ZOOM_STEP = 40

export function wheelZoom(
  pending: number,
  deltaY: number,
): { pending: number; dir: 'in' | 'out' | null } {
  const sum = pending * deltaY < 0 ? deltaY : pending + deltaY
  if (sum <= -WHEEL_ZOOM_STEP) return { pending: 0, dir: 'in' }
  if (sum >= WHEEL_ZOOM_STEP) return { pending: 0, dir: 'out' }
  return { pending: sum, dir: null }
}
