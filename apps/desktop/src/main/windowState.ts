import { readFileSync, renameSync, writeFileSync } from 'node:fs'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface WindowState {
  bounds: Rect
  maximized: boolean
}

const MIN_VISIBLE_PX = 100

const overlap = (a: Rect, b: Rect): Size => ({
  width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
})

export function resolveWindowBounds(
  saved: Rect | null,
  workAreas: Rect[],
  fallback: Size,
  min: Size,
): Size | Rect {
  if (!saved) return fallback
  const reachable = workAreas.some((area) => {
    const shared = overlap(saved, area)
    return shared.width >= MIN_VISIBLE_PX && shared.height >= MIN_VISIBLE_PX
  })
  if (!reachable) return fallback
  return {
    x: saved.x,
    y: saved.y,
    width: Math.max(saved.width, min.width),
    height: Math.max(saved.height, min.height),
  }
}

const isRect = (value: unknown): value is Rect => {
  if (typeof value !== 'object' || value === null) return false
  const rect = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every(
    (key) => typeof rect[key] === 'number' && Number.isFinite(rect[key]),
  )
}

export function loadWindowState(path: string): WindowState | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const { bounds, maximized } = parsed as Record<string, unknown>
    if (!isRect(bounds)) return null
    return { bounds, maximized: maximized === true }
  } catch {
    return null
  }
}

export function saveWindowState(path: string, state: WindowState): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(state), 'utf-8')
  renameSync(tmp, path)
}
