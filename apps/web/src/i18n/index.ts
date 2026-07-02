import { createInstance, type i18n } from 'i18next'
import { initReactI18next } from 'react-i18next'
import changelogEn from './changelog/en.json'
import changelogEs from './changelog/es.json'
import en from './locales/en.json'
import es from './locales/es.json'

export const LANGUAGES = ['es', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

// The release history lives in its own files (not the locale bundles) because the
// desktop app imports the same data for its "what's new" popup after an update.
export const resources = {
  es: { translation: { ...es, changelog: { ...es.changelog, releases: changelogEs } } },
  en: { translation: { ...en, changelog: { ...en.changelog, releases: changelogEn } } },
} as const

// A fresh instance per language keeps prerendered routes isolated: the ES and
// EN pages render in the same process, so a shared singleton would leak whatever
// language was set last into the other page's HTML.
export function createI18n(lng: Language): i18n {
  const instance = createInstance()
  void instance.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: 'es',
    interpolation: { escapeValue: false },
    returnObjects: true,
  })
  return instance
}
