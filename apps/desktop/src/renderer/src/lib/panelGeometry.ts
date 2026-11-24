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

// Air kept between the card and the window edge, and between the card and the button it
// hangs from (the same 8 px the capped menus keep clear of the edge).
export const PANEL_MARGIN = 8
const DEFAULT_WIDTH = 380

// Where the button that opens the card sits, measured when it opens.
export interface PanelAnchor {
  right: number
  bottom: number
}

type SavedPanelGeometry = { x: number; y: number; width: number; height: number } | null

// With nothing saved the card hangs from its button, right edges aligned (or the window's
// right margin when the button is closer to the edge than that), so it opens next to what
// opened it rather than in a fixed corner that assumes the window's width.
function anchoredGeometry(
  viewport: { width: number; height: number },
  anchor: PanelAnchor,
): PanelGeometry {
  const width = Math.max(MIN_WIDTH, Math.min(DEFAULT_WIDTH, viewport.width - 2 * PANEL_MARGIN))
  const right = Math.min(anchor.right, viewport.width - PANEL_MARGIN)
  const y = anchor.bottom + PANEL_MARGIN
  return {
    pos: { x: Math.max(PANEL_MARGIN, right - width), y },
    size: {
      width,
      height: Math.max(
        MIN_HEIGHT,
        Math.min(DEFAULT_GEOMETRY.size.height, viewport.height - y - PANEL_MARGIN),
      ),
    },
  }
}

// Restores the saved geometry, defaulting on junk and clamping into the current
// viewport — the window may have shrunk (or the panel was left on a bigger screen)
// since the value was saved, and a card restored fully off-screen could never be
// grabbed back.
export function clampPanelGeometry(
  saved: SavedPanelGeometry | undefined,
  viewport: { width: number; height: number },
  anchor?: PanelAnchor,
): PanelGeometry {
  if (!saved || ![saved.x, saved.y, saved.width, saved.height].every((n) => Number.isFinite(n)))
    return anchor ? anchoredGeometry(viewport, anchor) : DEFAULT_GEOMETRY
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
