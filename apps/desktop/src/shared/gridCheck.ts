import { gridOffsets, type GridFit } from './gridEdit'
import { gridVerdictOf, type GridVerdict } from './gridVerdict'

export interface GridCheck {
  hereMs: number
  endMs: number
  worstMs: number
  verdict: GridVerdict | null
}

export function checkGrid(input: {
  beats: number[]
  kicks: number[]
  fit: GridFit
  atMs: number
  durationMs: number
  verdict?: GridVerdict | null
}): GridCheck {
  const { beats, kicks, fit, atMs, durationMs } = input
  const { hereMs, endMs } = gridOffsets(beats, fit, atMs, durationMs, kicks)
  return {
    hereMs,
    endMs,
    worstMs: Math.max(Math.abs(hereMs), Math.abs(endMs)),
    verdict: input.verdict === undefined ? gridVerdictOf(beats, fit) : input.verdict,
  }
}

export function needsGridFix(check: GridCheck, toleranceMs: number): boolean {
  return check.worstMs > toleranceMs || check.verdict !== null
}
