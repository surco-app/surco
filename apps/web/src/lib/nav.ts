import { LANGUAGES, type Language } from '../i18n'

// Every language but Spanish lives under its own prefix, with the English page names
// after it (/ja/guide, /pt/guide); Spanish keeps the original unprefixed Spanish URLs.
const PREFIX: Record<Exclude<Language, 'es'>, string> = {
  en: '/en',
  de: '/de',
  fr: '/fr',
  'pt-BR': '/pt',
  ja: '/ja',
}

const localized = (es: string, rest: string): Record<Language, string> =>
  Object.fromEntries(
    LANGUAGES.map((lng) => [lng, lng === 'es' ? es : `${PREFIX[lng]}${rest}`]),
  ) as Record<Language, string>

export const HOME = localized('/', '')

export const PAGES = {
  features: localized('/funciones', '/features'),
  guide: localized('/guia', '/guide'),
  useCases: localized('/casos-de-uso', '/use-cases'),
  changelog: localized('/cambios', '/changelog'),
  flacToAiff: localized('/convertir/flac-a-aiff', '/convert/flac-to-aiff'),
  privacy: localized('/privacidad', '/privacy'),
  stats: localized('/estadisticas', '/stats'),
}

export type Page = keyof typeof PAGES
