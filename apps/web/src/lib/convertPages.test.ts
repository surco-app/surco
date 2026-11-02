import { describe, expect, it } from 'vitest'
import { LANGUAGES, resources } from '../i18n'
import { CONVERT_PAGES, otherConversions } from './convertPages'
import { PAGES } from './nav'

const TEXTS = [
  'metaTitle',
  'metaDescription',
  'h1a',
  'h1b',
  'lede',
  'note',
  'example.label',
  'example.arrow',
  'carry.kicker',
  'carry.title',
  'carry.lede',
  'carry.head.what',
  'carry.head.result',
  'carry.head.how',
  'why.kicker',
  'why.title',
  'steps.kicker',
  'steps.title',
  'steps.guide',
  'quality.kicker',
  'quality.title',
  'quality.lede',
  'faq.kicker',
  'faq.title',
  'outro.title',
  'outro.lede',
]
const LISTS = ['example.keeps', 'carry.rows', 'why.items', 'steps.items', 'faq.items']

const at = (tree: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
      tree,
    )

describe('conversion pages', () => {
  // These are landing pages people reach from a search for one conversion: a key missing
  // in one language prints the raw key as its title, and the FAQ feeds the page's
  // structured data, so an empty list ships an empty FAQPage to search engines.
  it('carries every text each page renders, in every language', () => {
    const missing = LANGUAGES.flatMap((lng) => {
      const copy = resources[lng].translation
      return CONVERT_PAGES.flatMap((page) => [
        ...TEXTS.filter((key) => {
          const value = at(copy, `${page}.${key}`)
          return typeof value !== 'string' || value === ''
        }).map((key) => `${lng} ${page}.${key}`),
        ...LISTS.filter((key) => {
          const value = at(copy, `${page}.${key}`)
          return !Array.isArray(value) || value.length === 0
        }).map((key) => `${lng} ${page}.${key}`),
      ])
    })
    expect(missing).toEqual([])
  })

  it('names every page in the footer, in every language', () => {
    const missing = LANGUAGES.flatMap((lng) =>
      CONVERT_PAGES.filter(
        (page) => typeof at(resources[lng].translation, `footer.${page}`) !== 'string',
      ).map((page) => `${lng} ${page}`),
    )
    expect(missing).toEqual([])
  })

  it('serves every page under its own path', () => {
    const paths = CONVERT_PAGES.map((page) => PAGES[page].es)
    expect(new Set(paths).size).toBe(CONVERT_PAGES.length)
  })

  // Each page is a door for one search; the others are one click away so a visitor who
  // landed on FLAC to AIFF learns Surco also goes the other way, to MP3.
  it('links each page to all the others and never to itself', () => {
    for (const page of CONVERT_PAGES) {
      const others = otherConversions(page)
      expect(others).not.toContain(page)
      expect([...others, page].sort()).toEqual([...CONVERT_PAGES].sort())
    }
  })
})
