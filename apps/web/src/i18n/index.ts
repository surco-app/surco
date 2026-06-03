import { createInstance, type i18n } from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import es from './locales/es.json'

export const LANGUAGES = ['es', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

export const resources = {
  es: { translation: es },
  en: { translation: en },
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
