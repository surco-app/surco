import { createInstance, type i18n } from 'i18next'
import { initReactI18next } from 'react-i18next'

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

type Translation = { changelog: object } & Record<string, unknown>

const LOCALES = import.meta.glob<Translation>('./locales/*.json', { import: 'default' })
// The release history lives in its own files (not the locale bundles) because the
// desktop app imports the same data for its "what's new" popup after an update.
const HISTORIES = import.meta.glob<unknown[]>('./changelog/*.json', { import: 'default' })
const LATEST = import.meta.glob<unknown>('./changelog/*.json', {
  import: 'default',
  query: '?latest',
})
const LANGUAGE_OFFERS = import.meta.glob<unknown>('./locales/*.json', {
  import: 'default',
  query: '?languageOffer',
  eager: true,
})

const offerOf = (lng: Language) => LANGUAGE_OFFERS[`./locales/${lng}.json`]

// A fresh instance per language keeps prerendered routes isolated: all locale
// pages render in the same process, so a shared singleton would leak whatever
// language was set last into the other page's HTML.
function createI18n(lng: Language, translation: Translation): i18n {
  const instance = createInstance()
  void instance.use(initReactI18next).init({
    resources: Object.fromEntries(
      LANGUAGES.map((other) => [
        other,
        {
          translation: other === lng ? translation : { nav: { languageOffer: offerOf(other) } },
        },
      ]),
    ),
    lng,
    fallbackLng: 'es',
    interpolation: { escapeValue: false },
    returnObjects: true,
  })
  return instance
}

async function load(lng: Language, withReleases: boolean): Promise<i18n> {
  const [locale, latest, releases] = await Promise.all([
    LOCALES[`./locales/${lng}.json`](),
    LATEST[`./changelog/${lng}.json`](),
    withReleases ? HISTORIES[`./changelog/${lng}.json`]() : undefined,
  ])
  return createI18n(lng, {
    ...locale,
    changelog: { ...locale.changelog, latest, ...(releases && { releases }) },
  })
}

const loading = new Map<string, Promise<i18n>>()

export function loadI18n(lng: Language, { releases = false } = {}): Promise<i18n> {
  const key = `${lng}:${releases}`
  const cached = loading.get(key) ?? load(lng, releases)
  loading.set(key, cached)
  return cached
}
