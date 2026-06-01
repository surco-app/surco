import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import es from './locales/es.json'
import en from './locales/en.json'

const language = navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'

void i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en }
  },
  lng: language,
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export default i18n
