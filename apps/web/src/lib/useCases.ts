import en from '../i18n/locales/en.json'
import es from '../i18n/locales/es.json'
import { PAGES } from './nav'

export const USE_CASE_SOURCES = [
  'folder',
  'appleMusic',
  'rekordbox',
  'engineDj',
  'usb',
  'nas',
] as const

export type UseCaseSource = (typeof USE_CASE_SOURCES)[number]

export const USE_CASE_SOURCES_BY_CASE: Record<string, UseCaseSource[]> = {
  'in-place': ['folder'],
  replace: ['appleMusic', 'rekordbox'],
  'apple-music-rekordbox': ['appleMusic', 'rekordbox'],
  'to-aiff': ['folder'],
  'check-quality': ['folder'],
  vinyl: ['folder'],
  usb: ['usb'],
  'review-spellings': ['appleMusic'],
  duplicates: ['appleMusic'],
  'review-folder': ['folder'],
  'find-replace': ['folder'],
  beatport: ['folder'],
  'watched-folder': ['folder'],
  loudness: ['folder'],
  'engine-dj': ['engineDj'],
  'music-playlist-set': ['appleMusic', 'usb'],
  nas: ['nas'],
}

type Searchable = { id: string; title: string; body: string[]; keywords: string }

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

const words = (text: string) =>
  fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

export function matchesUseCase(c: Searchable, query: string, source: UseCaseSource | null) {
  if (source && !USE_CASE_SOURCES_BY_CASE[c.id]?.includes(source)) return false
  const haystack = words([c.title, ...c.body, c.keywords].join(' '))
  return words(query).every((q) => haystack.some((w) => w.startsWith(q)))
}

type Lang = 'es' | 'en'
type PagedCase = { id: string; slug: string }

const CASES: Record<Lang, PagedCase[]> = {
  es: es.useCases.cases,
  en: en.useCases.cases,
}

export const recipePath = (lang: Lang, slug: string) => `${PAGES.useCases[lang]}/${slug}`

const pathOf = (lang: Lang, c: PagedCase) => recipePath(lang, c.slug)

export type RecipePage = {
  id: string
  lang: Lang
  path: string
  alternates: Record<Lang, string>
}

export function recipePages(): RecipePage[] {
  return (['es', 'en'] as const).flatMap((lang) =>
    CASES[lang].map((c) => {
      const alternates = {
        es: pathOf('es', CASES.es.find((o) => o.id === c.id) ?? c),
        en: pathOf('en', CASES.en.find((o) => o.id === c.id) ?? c),
      }
      return { id: c.id, lang, path: alternates[lang], alternates }
    }),
  )
}

export function recipePathForAnchor(lang: Lang, hash: string): string | null {
  const c = CASES[lang].find((o) => `#${o.id}` === hash)
  return c ? pathOf(lang, c) : null
}
