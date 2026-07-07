// The shipped locales, in the ⌘⇧L cycle order. Every helper below collapses whatever
// tag the OS or i18next reports (es-ES, pt-PT, de-AT…) onto one of these, with English
// as the catch-all — a regional variant must never boot an untranslated UI.
export const LOCALES = ['en', 'es', 'de', 'fr', 'pt-BR'] as const
export type Locale = (typeof LOCALES)[number]

// Portuguese ships only as pt-BR, so every pt-* variant lands there; the others map to
// their base language.
const BASE_PREFIXES: readonly [string, Locale][] = [
  ['es', 'es'],
  ['de', 'de'],
  ['fr', 'fr'],
  ['pt', 'pt-BR'],
]

// The base locale of whatever tag i18next currently reports (en-US, es-ES…): the
// live-language counterpart of resolveLocale, for content that must follow a mid-
// session language switch.
export function baseLocale(current: string): Locale {
  const tag = current.toLowerCase()
  for (const [prefix, locale] of BASE_PREFIXES) if (tag.startsWith(prefix)) return locale
  return 'en'
}

// The ⌘⇧L toggle: step to the next shipped locale, collapsing a regional variant
// (es-ES, en-US) to its base language first so the cycle always starts on solid ground.
export function nextLocale(current: string): Locale {
  const i = LOCALES.indexOf(baseLocale(current))
  return LOCALES[(i + 1) % LOCALES.length]
}

// The locale of the OS, collapsed to a shipped one — the detection the i18n init uses.
export function systemLocale(): Locale {
  return baseLocale(navigator.language)
}

// The effective locale for a saved language preference: a pinned locale wins, 'system'
// (the default) follows the OS.
export function resolveLocale(pref: 'system' | Locale): Locale {
  return pref === 'system' ? systemLocale() : pref
}
