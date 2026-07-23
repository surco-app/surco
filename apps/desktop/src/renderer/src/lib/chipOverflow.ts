// El corte de la fila colapsada de chips de sugerencias: dados los anchos reales de cada
// chip, del chip "+N" y del contenedor, ¿cuántos chips caben en una sola línea dejando
// hueco para el "+N"? Pura para que la aritmética se testee sin layout; la medición DOM
// vive en useChipOverflow. Un contenedor de ancho 0 significa "sin medida fiable" (jsdom,
// aún sin layout), no un contenedor estrecho: ahí se muestra todo y no hay "+N".
export function computeVisibleChips(
  chipWidths: number[],
  moreChipWidth: number,
  containerWidth: number,
  gap: number,
): number {
  if (containerWidth <= 0) return chipWidths.length
  const total = chipWidths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, chipWidths.length - 1)
  if (total <= containerWidth) return chipWidths.length
  let sum = 0
  let fit = 0
  for (let i = 0; i < chipWidths.length; i++) {
    sum += chipWidths[i]
    if (sum + i * gap + gap + moreChipWidth <= containerWidth) fit = i + 1
  }
  return Math.max(1, fit)
}
