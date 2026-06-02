export function nextWidth(startWidth: number, deltaX: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, startWidth + deltaX))
}
