// The ⌘⇧L toggle only flips between the two shipped locales. A regional variant like
// es-ES or en-US can arrive from navigator.language or i18next, so collapse it to its
// base language first — anything that isn't Spanish counts as English, mirroring the
// startsWith('es') detection in ./index.ts.
export function nextLocale(current: string): 'en' | 'es' {
  return current.toLowerCase().startsWith('es') ? 'en' : 'es'
}
