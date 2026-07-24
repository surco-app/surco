import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The img-src allowlist lives in TWO places the browser intersects: the meta CSP in
// renderer/index.html (all builds) and the packaged-build header CSP in main/index.ts.
// A provider whose cover CDN is missing from either renders broken images everywhere
// its results appear — exactly how Deezer covers shipped blocked while Discogs and
// Bandcamp worked. These tests read both sources as text (the meta CSP is static HTML
// and cannot import a shared constant) so adding a search provider without allowing
// its image host fails loudly here.

// Every search provider's cover CDN, as it must appear in img-src.
const PROVIDER_IMAGE_HOSTS = [
  'https://i.discogs.com',
  'https://img.discogs.com',
  'https://*.bcbits.com',
  'https://*.dzcdn.net',
]

// Each extractor anchors on how its file quotes the directive (the HTML terminates it
// with `;`, the TS array entry with its closing double quote) — a bare `img-src` match
// would hit the phrase inside prose comments first.
function imgSrcOf(source: string, pattern: RegExp, file: string): string {
  const m = source.match(pattern)
  if (!m) throw new Error(`No img-src directive found in ${file}`)
  return m[1]
}

const root = join(__dirname, '..', '..')
const metaCsp = imgSrcOf(
  readFileSync(join(root, 'src/renderer/index.html'), 'utf-8'),
  /img-src ([^;]+);/,
  'index.html',
)
const headerCsp = imgSrcOf(
  readFileSync(join(root, 'src/main/index.ts'), 'utf-8'),
  /"img-src ([^"]+)"/,
  'main/index.ts',
)

describe('img-src cover-CDN allowlists', () => {
  it('allows every search provider cover CDN in the meta CSP', () => {
    for (const host of PROVIDER_IMAGE_HOSTS) expect(metaCsp).toContain(host)
  })

  it('allows every search provider cover CDN in the packaged header CSP', () => {
    for (const host of PROVIDER_IMAGE_HOSTS) expect(headerCsp).toContain(host)
  })

  // The header CSP intersects the meta one in packaged builds, so a host present in
  // only one list still renders broken images in production while dev looks fine.
  it('keeps both img-src lists identical so dev and packaged builds agree', () => {
    expect(headerCsp.trim().split(/\s+/).sort()).toEqual(metaCsp.trim().split(/\s+/).sort())
  })
})
