import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { systemLocale } from './locale'
import en from './locales/en.json'

// English is the fallback i18next falls back to for any missing/unloaded key, so it
// must be present synchronously at import time. The other four locales are ~50 KB of
// JSON each and only one is ever active per session — loading them eagerly would ship
// ~200 KB the user never reads. Each is fetched with a dynamic import (its own Vite
// chunk) only when it becomes the active language, and cached here so a repeat switch
// back to an already-seen locale doesn't re-fetch.
const LAZY_LOCALES = {
  es: () => import('./locales/es.json'),
  de: () => import('./locales/de.json'),
  fr: () => import('./locales/fr.json'),
  'pt-BR': () => import('./locales/pt-BR.json'),
} as const
type LazyLocale = keyof typeof LAZY_LOCALES

function isLazyLocale(lng: string): lng is LazyLocale {
  return lng in LAZY_LOCALES
}

// Fetches and registers a lazy locale's bundle at most once; a bundle already present
// (already fetched, or English which never needs this) resolves immediately.
async function ensureLocaleLoaded(lng: string): Promise<void> {
  if (!isLazyLocale(lng) || i18n.hasResourceBundle(lng, 'translation')) return
  const mod = await LAZY_LOCALES[lng]()
  i18n.addResourceBundle(lng, 'translation', mod.default)
}

// First paint uses the OS locale; once settings load, useSettings applies the saved
// language preference (which may pin a locale or keep following the system).
const language = systemLocale()

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
  },
  lng: language,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

// Every caller (useSettings, App's language toggle, tests) drives language switches
// through this same changeLanguage — wrapping it here, once, on the shared instance is
// simpler than threading the lazy-load through each call site. The bundle is fetched
// and registered before the underlying changeLanguage resolves, so t() never falls
// through to a raw key: while the fetch is in flight it keeps resolving through the
// English fallback (or whatever locale was active before), exactly like a cold
// i18next fallback today.
//
// Two hazards a synchronous-resource init never had to worry about, now that the
// registration step is async:
// - Races: two switches can be in flight at once (e.g. the module's own OS-locale
//   apply below racing useSettings' saved-preference effect on mount). Whichever
//   bundle happens to resolve last must not silently override a newer request. A
//   "latest requested" token records the most recent call; a request only applies
//   once its bundle is ready if it's still the latest — a superseded one just
//   resolves without touching the language.
// - Failure: a dynamic import can reject (e.g. a chunk fails to load over a flaky
//   connection). Callers use `void changeLanguage(...)` and don't catch, so a
//   rejection here would surface as an unhandled rejection and pop App's generic
//   error banner — a regression versus eager loading, where this could never fail.
//   Degrade silently instead: stay on the current language, still resolve.
let latestRequested: string | undefined
const changeLanguage = i18n.changeLanguage.bind(i18n)
i18n.changeLanguage = ((lng?: string, callback?: (error: unknown, t: unknown) => void) => {
  if (lng === undefined) return changeLanguage(lng, callback)
  latestRequested = lng
  return ensureLocaleLoaded(lng)
    .then(() => {
      if (latestRequested !== lng) return i18n.t
      return changeLanguage(lng, callback)
    })
    .catch(() => i18n.t)
}) as typeof i18n.changeLanguage

// A non-English OS locale must still end up in its own language, not stuck on the
// English first paint forever — load it once init's synchronous English resources
// are in place. This is the one cold-start case that may briefly flash English.
if (language !== 'en') void i18n.changeLanguage(language)

export default i18n
