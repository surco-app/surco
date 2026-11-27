// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import Header from './components/Header'
import { loadI18n } from './i18n'

const i18n = await loadI18n('es')
const doc = new DOMParser().parseFromString(
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(Header))),
  'text/html',
)
const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)

describe('header, sized like Cuts and Nada', () => {
  const home = doc.querySelector('header a[href="#top"]')

  it('shows the logo at the 36px the sibling sites use, beside the name in body size', () => {
    const logo = home?.querySelector('img')
    expect(logo?.getAttribute('width')).toBe('36')
    expect(classes(logo ?? null)).not.toContain('sm:h-12')
    const name = home?.querySelector('span') ?? null
    expect(classes(name)).toContain('font-semibold')
    expect(classes(name)).not.toContain('text-xl')
  })

  it("draws the theme toggle as the family's square ghost button", () => {
    const toggle = doc.querySelector('[data-testid="theme-toggle"]')
    for (const utility of ['size-8', 'rounded-md', 'hover:bg-surface', 'active:scale-[0.97]'])
      expect(classes(toggle)).toContain(utility)
  })

  it("lets the new glyph pop in when the theme flips, as Nada's toggle does, unless motion is reduced", () => {
    const glyphs = [
      ...(doc.querySelector('[data-testid="theme-toggle"]')?.querySelectorAll('svg') ?? []),
    ]
    expect(glyphs).toHaveLength(2)
    for (const glyph of glyphs) {
      expect(classes(glyph)).toContain('starting:opacity-0')
      expect(classes(glyph)).toContain('motion-reduce:starting:scale-100')
    }
  })

  it('squares the menu button to match the toggle beside it, instead of a lone round pill', () => {
    const menu = classes(doc.querySelector('[data-testid="header-menu-toggle"]'))
    expect(menu).toContain('rounded-lg')
    expect(menu).not.toContain('rounded-full')
  })
})

describe('headings across the site, on the family type scale', () => {
  const root = join(import.meta.dirname)
  const sources = (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.tsx') && !/^components\/scenes\/(?!SceneLayout)/.test(f))
    .map((f) => [f, readFileSync(join(root, f), 'utf8')] as const)
  const headings = (level: 1 | 2) =>
    sources.flatMap(([file, code]) =>
      [...code.matchAll(new RegExp(`<h${level}\\b[^>]*?className=\\{?[\`"]([^\`"]*)`, 'g'))].map(
        (m) => [file, m[1]] as const,
      ),
    )

  it('sets every page headline in semibold, the weight Cuts and Nada use, never bold', () => {
    expect(headings(1).length).toBeGreaterThan(0)
    for (const [file, cls] of headings(1)) {
      expect(cls, file).toContain('font-semibold')
      expect(cls, file).not.toContain('font-bold')
    }
  })

  it('keeps section headings at the family 2xl, so none rivals the page headline', () => {
    expect(headings(2).length).toBeGreaterThan(0)
    for (const [file, cls] of headings(2)) {
      if (cls.includes('text-lg')) continue
      expect(cls.split(/\s+/), file).toContain('text-2xl')
      expect(cls, file).not.toMatch(/sm:text-[3-6]xl|text-\[min/)
    }
  })
})

describe('text links, styled as the family styles them', () => {
  const root = join(import.meta.dirname)
  const sources = (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.tsx') && !f.startsWith('components/scenes/'))
    .map((f) => [f, readFileSync(join(root, f), 'utf8')] as const)

  it('draws links in ink with an underline on hover, keeping Surco blue for the one accent', () => {
    const blueLinks = sources.flatMap(([file, code]) =>
      [...code.matchAll(/className="([^"]*)"/g)]
        .map((m) => m[1])
        .filter(
          (cls) =>
            /hover:text-cyan/.test(cls) ||
            (/(^|\s)text-blue(\s|$)/.test(cls) && /hover:underline/.test(cls)),
        )
        .map((cls) => `${file}: ${cls}`),
    )
    expect(blueLinks).toEqual([])
  })
})
