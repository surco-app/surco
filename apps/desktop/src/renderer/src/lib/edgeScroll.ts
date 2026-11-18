const EDGE_PX = 56
const TOP_SPEED_PX = 18

export function edgeScrollStep(pointerY: number, top: number, bottom: number): number {
  const intoTop = top + EDGE_PX - pointerY
  if (intoTop > 0) return -Math.ceil(TOP_SPEED_PX * Math.min(1, intoTop / EDGE_PX))
  const intoBottom = pointerY - (bottom - EDGE_PX)
  if (intoBottom > 0) return Math.ceil(TOP_SPEED_PX * Math.min(1, intoBottom / EDGE_PX))
  return 0
}
