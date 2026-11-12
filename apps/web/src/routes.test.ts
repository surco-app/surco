import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider, type I18nextProviderProps } from 'react-i18next'
import type { RouteObject } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LatestRelease from './components/LatestRelease'
import { LANGUAGES } from './i18n'
import releasesJa from './i18n/changelog/ja.json'
import { HOME, PAGES } from './lib/nav'

const loaded = new Set<string>()

const pages = async () => {
  const { routes } = await import('./routes')
  return routes[0].children as RouteObject[]
}

const open = async (path: string) => {
  const route = (await pages()).find((r) => (path === '/' ? r.index : `/${r.path}` === path))
  if (!route?.lazy) throw new Error(`No lazy route at ${path}`)
  const { element } = (await route.lazy()) as { element: ReactElement<I18nextProviderProps> }
  return element
}

describe('what each page downloads', () => {
  beforeEach(() => {
    vi.resetModules()
    loaded.clear()
    for (const file of LANGUAGES.flatMap((lng) => [`locales/${lng}.json`, `changelog/${lng}.json`]))
      vi.doMock(`./i18n/${file}`, async (importOriginal) => {
        loaded.add(file)
        return importOriginal()
      })
  })

  it('loads no language and no release history to know the site map', async () => {
    await pages()
    expect([...loaded]).toEqual([])
  })

  it.each(LANGUAGES)('loads only the %s copy for its home page', async (lng) => {
    await open(HOME[lng])
    expect([...loaded]).toEqual([`locales/${lng}.json`])
  })

  it.each(LANGUAGES)('adds only the %s release history on its changelog page', async (lng) => {
    await open(PAGES.changelog[lng])
    expect([...loaded].sort()).toEqual([`changelog/${lng}.json`, `locales/${lng}.json`])
  })

  it('still announces the newest release on the home page without the history', async () => {
    const { i18n } = (await open(HOME.ja)).props
    const html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n }, createElement(LatestRelease)),
    )
    expect(html).toContain(releasesJa[0].title)
    expect(loaded.has('changelog/ja.json')).toBe(false)
  })
})
