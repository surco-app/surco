// The canonical origin every absolute URL on the site is built from — canonical tags,
// og:url, the sitemap.
export const SITE = 'https://getsurco.app'

// The routes that belong in the sitemap, in crawl-priority order. Kept here rather than
// read off routes.tsx (which is JSX, and would drag React into the build script) with a
// test holding the two in step, so a new page can't be served-but-unlisted the way
// /funciones was.
import { recipePages } from './useCases'

export const INDEXABLE_PATHS: readonly string[] = [
  '/',
  '/en',
  '/ja',
  '/funciones',
  '/en/features',
  '/ja/features',
  '/guia',
  '/en/guide',
  '/ja/guide',
  '/casos-de-uso',
  '/en/use-cases',
  '/ja/use-cases',
  '/cambios',
  '/en/changelog',
  '/ja/changelog',
  '/convertir/flac-a-aiff',
  '/en/convert/flac-to-aiff',
  '/ja/convert/flac-to-aiff',
  '/privacidad',
  '/en/privacy',
  '/ja/privacy',
  ...recipePages().map((page) => page.path),
]
