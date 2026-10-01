// A figure with a fixed number of decimals in the app language's decimal mark ("44,1" in
// Spanish, "44.1" in English). The digit count stays fixed so a column of readouts keeps
// its width, and grouping is off because these are measurements, not counts.
export function formatFixed(value: number, digits: number, language: string): string {
  return new Intl.NumberFormat(language, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(value)
}

// Up to `digits` decimals, dropping the ones that are zero: a sample rate reads "44,1 kHz"
// and "96 kHz", a zoom factor "×3,4" and "×2".
export function formatUpTo(value: number, digits: number, language: string): string {
  return new Intl.NumberFormat(language, {
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(value)
}
