import { createInstance, type i18n } from 'i18next'
import { initReactI18next } from 'react-i18next'
import changelogDe from './changelog/de.json'
import changelogEn from './changelog/en.json'
import changelogEs from './changelog/es.json'
import changelogFr from './changelog/fr.json'
import changelogJa from './changelog/ja.json'
import changelogPtBR from './changelog/pt-BR.json'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ptBR from './locales/pt-BR.json'

// The app's languages, in the order its own language picker lists them.
export const LANGUAGES = ['es', 'en', 'de', 'fr', 'pt-BR', 'ja'] as const
export type Language = (typeof LANGUAGES)[number]
export const LANGUAGE_NAMES: Record<Language, string> = {
  es: 'Español',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  'pt-BR': 'Português',
  ja: '日本語',
}

// The release history lives in its own files (not the locale bundles) because the
// desktop app imports the same data for its "what's new" popup after an update.
export const resources = {
  es: { translation: { ...es, changelog: { ...es.changelog, releases: changelogEs } } },
  en: { translation: { ...en, changelog: { ...en.changelog, releases: changelogEn } } },
  de: { translation: { ...de, changelog: { ...de.changelog, releases: changelogDe } } },
  fr: { translation: { ...fr, changelog: { ...fr.changelog, releases: changelogFr } } },
  'pt-BR': { translation: { ...ptBR, changelog: { ...ptBR.changelog, releases: changelogPtBR } } },
  ja: { translation: { ...ja, changelog: { ...ja.changelog, releases: changelogJa } } },
} as const

// A fresh instance per language keeps prerendered routes isolated: all locale
// pages render in the same process, so a shared singleton would leak whatever
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
