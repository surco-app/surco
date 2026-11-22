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
  'https://geo-media.beatport.com',
  // MusicBrainz covers come from the Cover Art Archive, which redirects every image to
  // archive.org and from there to a numbered mirror (dn720707.ca.archive.org). The CSP
  // checks each hop, and `*.archive.org` does not cover the bare apex, so all three
  // must be listed or the thumbnail breaks on the first redirect.
  'https://coverartarchive.org',
  'https://archive.org',
  'https://*.archive.org',
  'https://*.mzstatic.com',
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

// The player warms an AIFF's transcode by fetching its surco:// URL when the track is
// selected; without surco: in connect-src that fetch is refused on every selection, so the
// first play of an AIFF still waits for the whole transcode.
describe('connect-src', () => {
  const connectSrc = (source: string, pattern: RegExp): string[] =>
    (source.match(pattern)?.[1] ?? '').trim().split(/\s+/)
  const meta = connectSrc(
    readFileSync(join(root, 'src/renderer/index.html'), 'utf-8'),
    /connect-src ([^;"]+)/,
  )
  const header = connectSrc(
    readFileSync(join(root, 'src/main/index.ts'), 'utf-8'),
    /"connect-src ([^"]+)"/,
  )

  it('lets the renderer fetch surco:// media in the meta and the packaged header CSP', () => {
    expect(meta).toContain('surco:')
    expect(header).toContain('surco:')
  })
})

// connect-src lets the fetch out, but Chromium still refuses a fetch from the page to a
// scheme it does not treat as CORS-capable, so the prewarm needs both.
describe('surco:// scheme', () => {
  it('is registered as CORS-capable, so the renderer can fetch from it', () => {
    const main = readFileSync(join(root, 'src/main/index.ts'), 'utf-8')
    const privileges = main.match(/scheme: MEDIA_SCHEME,\s*privileges: \{([^}]+)\}/)?.[1] ?? ''
    expect(privileges).toContain('corsEnabled: true')
  })
})
