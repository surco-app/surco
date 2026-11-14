const MARGIN = 16
const MAX_WIDTH = 320

export function offerPlacement(
  button: { left: number; right: number },
  viewportWidth: number,
): { left: number; width: number; arrow: number } {
  const width = Math.min(MAX_WIDTH, viewportWidth - 2 * MARGIN)
  const left = Math.max(MARGIN, Math.min(button.right - width, viewportWidth - MARGIN - width))
  const centre = (button.left + button.right) / 2
  const arrow = Math.max(MARGIN, Math.min(centre - left, width - MARGIN))
  return { left, width, arrow }
}

export function showOffer(
  offered: string | null,
  menuOpen: boolean,
  languageOpen: boolean,
): boolean {
  return offered !== null && !menuOpen && !languageOpen
}
