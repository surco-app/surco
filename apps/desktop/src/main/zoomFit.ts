interface Size {
  width: number
  height: number
}

const STEP = 0.5

const factorOf = (level: number): number => 1.2 ** level

const minimumAt = (level: number, min: Size): Size => ({
  width: Math.max(min.width, Math.ceil(min.width * factorOf(level))),
  height: Math.max(min.height, Math.ceil(min.height * factorOf(level))),
})

const fits = (size: Size, area: Size): boolean =>
  size.width <= area.width && size.height <= area.height

export function zoomFit(level: number, area: Size, min: Size): { level: number; minimum: Size } {
  let fitted = level
  while (fitted > 0 && !fits(minimumAt(fitted, min), area)) fitted = Math.max(0, fitted - STEP)
  return { level: fitted, minimum: minimumAt(fitted, min) }
}
