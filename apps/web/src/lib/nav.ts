// Both header and footer surface a curated subset of the landing's sections, not
// the full index: this is a single-page site, so re-listing every anchor (Speed,
// Analysis, Shortcuts…) is noise. Each keeps only the links worth a deliberate jump.
export const HEADER_SECTIONS = ['como'] as const
export const FOOTER_SECTIONS = ['instalar', 'precio', 'faq'] as const

export const PAGES = {
  features: { es: '/funciones', en: '/en/features' },
  guide: { es: '/guia', en: '/en/guide' },
  changelog: { es: '/cambios', en: '/en/changelog' },
} as const

export type Page = keyof typeof PAGES
