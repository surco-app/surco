// The activity panel's persisted geometry: clamp in one tested place so the component
// only deals with valid values. Stored in the machine-local settings (a pixel position
// only means something on the screen it was saved on); null until first moved.

// Floor sizes: below these the header controls collide and the list shows nothing
// useful, so neither the resize grip nor a restored value can shrink the card into
// uselessness.
export const MIN_WIDTH = 260
export const MIN_HEIGHT = 160

export interface PanelGeometry {
  pos: { x: number; y: number }
  size: { width: number; height: number }
}

export const DEFAULT_GEOMETRY: PanelGeometry = {
  pos: { x: 24, y: 80 },
  size: { width: 320, height: 360 },
}

export type SavedPanelGeometry = { x: number; y: number; width: number; height: number } | null

// Restores the saved geometry, defaulting on junk and clamping into the current
// viewport — the window may have shrunk (or the panel was left on a bigger screen)
// since the value was saved, and a card restored fully off-screen could never be
// grabbed back.
export function clampPanelGeometry(
  saved: SavedPanelGeometry | undefined,
  viewport: { width: number; height: number },
): PanelGeometry {
  if (
    !saved ||
    ![saved.x, saved.y, saved.width, saved.height].every((n) => Number.isFinite(n))
  )
    return DEFAULT_GEOMETRY
  return {
    // The same reachability clamp the drag applies: part of the header must stay on screen.
    pos: {
      x: Math.max(0, Math.min(viewport.width - 120, saved.x)),
      y: Math.max(0, Math.min(viewport.height - 40, saved.y)),
    },
    size: {
      width: Math.max(MIN_WIDTH, saved.width),
      height: Math.max(MIN_HEIGHT, saved.height),
    },
  }
}
