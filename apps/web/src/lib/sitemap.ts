// The canonical origin every absolute URL on the site is built from — canonical tags,
// og:url, the sitemap.
export const SITE = 'https://getsurco.app'

// The routes that belong in the sitemap, in crawl-priority order. Kept here rather than
// read off routes.tsx (which is JSX, and would drag React into the build script) with a
// test holding the two in step, so a new page can't be served-but-unlisted the way
// /funciones was.
export const INDEXABLE_PATHS = [
  '/',
  '/en',
  '/funciones',
  '/en/features',
  '/guia',
  '/en/guide',
  '/cambios',
  '/en/changelog',
] as const
