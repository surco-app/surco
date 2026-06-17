// The ⌘⇧L toggle only flips between the two shipped locales. A regional variant like
// es-ES or en-US can arrive from navigator.language or i18next, so collapse it to its
// base language first — anything that isn't Spanish counts as English, mirroring the
// startsWith('es') detection in ./index.ts.
export function nextLocale(current: string): 'en' | 'es' {
  return current.toLowerCase().startsWith('es') ? 'en' : 'es'
}

// The base locale of the OS, collapsing regional variants (es-ES, es-419…) to 'es' and
// anything else to 'en' — the same detection the i18n init uses.
export function systemLocale(): 'en' | 'es' {
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
}

// The effective locale for a saved language preference: a pinned locale wins, 'system'
// (the default) follows the OS.
export function resolveLocale(pref: 'system' | 'en' | 'es'): 'en' | 'es' {
  return pref === 'system' ? systemLocale() : pref
}
