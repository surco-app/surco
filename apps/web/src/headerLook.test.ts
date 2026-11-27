// @vitest-environment jsdom
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
