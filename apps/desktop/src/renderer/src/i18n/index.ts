import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { systemLocale } from './locale'
import en from './locales/en.json'
import es from './locales/es.json'

// First paint uses the OS locale; once settings load, useSettings applies the saved
// language preference (which may pin a locale or keep following the system).
const language = systemLocale()

void i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
  },
  lng: language,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
