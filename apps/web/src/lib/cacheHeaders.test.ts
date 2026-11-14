import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface HeaderRule {
  source: string
  headers: { key: string; value: string }[]
}

const vercel = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../vercel.json', import.meta.url)), 'utf8'),
) as { headers: HeaderRule[] }

const PUBLIC = fileURLToPath(new URL('../../public', import.meta.url))
const MEDIA = /\.(webp|png|jpg|svg|webm|mp4)$/

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })

const media = files(PUBLIC)
  .map((path) => `/${relative(PUBLIC, path)}`)
  .filter((path) => MEDIA.test(path))

const cacheControl = (path: string) =>
  vercel.headers
    .filter((rule) => new RegExp(`^${rule.source}$`).test(path))
    .flatMap((rule) => rule.headers)
    .filter((header) => header.key === 'Cache-Control')
    .map((header) => header.value)
    .at(-1)

describe('cache headers for the images and videos in public/', () => {
  it('finds the hero, the guide shots and the use case shots to check', () => {
    expect(media).toEqual(
      expect.arrayContaining(['/hero-app-es.webp', '/hero-app-es.webm', '/logo.svg']),
    )
    expect(media.length).toBeGreaterThan(300)
  })

  it.each(media)('lets the CDN keep %s and refresh it in the background', (path) => {
    const value = cacheControl(path)
    expect(value).toMatch(/s-maxage=\d+/)
    expect(value).toMatch(/stale-while-revalidate=\d+/)
  })

  it.each(media)('never pins %s for good, since its name does not change when it does', (path) => {
    expect(cacheControl(path)).not.toMatch(/immutable/)
  })

  it('keeps the hashed bundles immutable', () => {
    expect(cacheControl('/assets/app-D0REKscl.js')).toBe('public, max-age=31536000, immutable')
  })
})
