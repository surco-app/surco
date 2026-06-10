export const SECTIONS = ['velocidad', 'como', 'analisis', 'funciones', 'atajos', 'precio', 'instalar'] as const

// The header stays short on purpose: only the links a first-time visitor needs.
// The footer keeps linking every section through SECTIONS.
export const HEADER_SECTIONS = ['como', 'funciones', 'precio'] as const

export const PAGES = {
  guide: { es: '/guia', en: '/en/guide' },
  changelog: { es: '/cambios', en: '/en/changelog' },
} as const

export type Page = keyof typeof PAGES
