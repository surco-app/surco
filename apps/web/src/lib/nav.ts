// Both header and footer surface a curated subset of the landing's sections, not
// the full index: this is a single-page site, so re-listing every anchor (Speed,
// Analysis, Shortcuts…) is noise. Each keeps only the links worth a deliberate jump.
export const HEADER_SECTIONS = ['como'] as const

export const HOME = { es: '/', en: '/en', ja: '/ja' } as const

export const PAGES = {
  features: { es: '/funciones', en: '/en/features', ja: '/ja/features' },
  guide: { es: '/guia', en: '/en/guide', ja: '/ja/guide' },
  useCases: { es: '/casos-de-uso', en: '/en/use-cases', ja: '/ja/use-cases' },
  changelog: { es: '/cambios', en: '/en/changelog', ja: '/ja/changelog' },
  flacToAiff: {
    es: '/convertir/flac-a-aiff',
    en: '/en/convert/flac-to-aiff',
    ja: '/ja/convert/flac-to-aiff',
  },
  privacy: { es: '/privacidad', en: '/en/privacy', ja: '/ja/privacy' },
} as const

export type Page = keyof typeof PAGES
