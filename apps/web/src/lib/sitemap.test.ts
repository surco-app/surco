import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { INDEXABLE_PATHS, SITE } from './sitemap'

const sitemap = readFileSync(
  fileURLToPath(new URL('../../public/sitemap.xml', import.meta.url)),
  'utf8',
)
const routesSrc = readFileSync(fileURLToPath(new URL('../routes.tsx', import.meta.url)), 'utf8')

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort()
}

// The sitemap is a hand-written file listing pages defined somewhere else, so adding a
// route silently leaves it behind: /funciones — the page holding the formats, the Discogs
// and Engine DJ copy, the shortcut table and the FAQ, and the target of the home's closing
// CTA — was missing from it while being linked from every page on the site.
// The PayPal return pages are real routes that must never be indexed: they are
// transactional dead ends, and a search result landing on "thanks for donating"
// would be nonsense.
const EXCLUDED = ['/donate/cancel', '/donate/completed']

describe('sitemap', () => {
  it('lists every indexable route', () => {
    expect(locs(sitemap)).toEqual([...INDEXABLE_PATHS].map((p) => `${SITE}${p}`).sort())
  })

  // The guard that keeps the two in step: every path routes.tsx serves must be either
  // declared indexable or deliberately excluded, so a new page cannot be forgotten.
  it('accounts for every path routes.tsx serves', () => {
    const served = [...routesSrc.matchAll(/\bpath: '([^']+)'/g)]
      .map((m) => m[1])
      .filter((p) => p !== '/')
      .map((p) => `/${p}`)
    const indexable: readonly string[] = INDEXABLE_PATHS
    const unaccounted = served.filter((p) => !indexable.includes(p) && !EXCLUDED.includes(p))
    expect(unaccounted).toEqual([])
  })

  // Leaving a page out of the sitemap does not keep it out of the index: every page
  // inherited `index, follow`, so a crawler that found a PayPal return URL could list it.
  it('marks every excluded page noindex', () => {
    for (const path of EXCLUDED) {
      const start = routesSrc.indexOf(`path: '${path.slice(1)}'`)
      expect(start).toBeGreaterThan(-1)
      expect(routesSrc.slice(start, routesSrc.indexOf('entry:', start))).toContain('<NoIndex>')
    }
  })

  it('points every entry at the canonical host', () => {
    for (const loc of locs(sitemap)) expect(loc.startsWith(`${SITE}/`)).toBe(true)
  })
})
