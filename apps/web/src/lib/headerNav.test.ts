import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import Footer from '../components/Footer'
import Header from '../components/Header'
import { DONATE_URL } from '../config'
import { createI18n } from '../i18n'
import { PAGES } from './nav'

function render(component: typeof Header | typeof Footer): string {
  return renderToStaticMarkup(
    createElement(I18nextProvider, { i18n: createI18n('es') }, createElement(component)),
  )
}

function block(html: string, testid: string): string {
  const start = html.indexOf(`data-testid="${testid}"`)
  expect(start, `${testid} not found`).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</nav>', start))
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])

// The header held nine items: six links, the theme, the language by name and the download.
// It keeps the four pages a visitor goes looking for. "Cómo funciona" only jumped to a
// section of the same home page, which scrolling reaches anyway, and "Donar" sat level with
// the download it competed with; both live in the footer.
describe('header navigation', () => {
  const pages = [PAGES.features.es, PAGES.guide.es, PAGES.useCases.es, PAGES.changelog.es]

  for (const testid of ['header-nav', 'header-mobile-nav']) {
    it(`${testid} links the four pages and nothing else`, () => {
      expect(hrefs(block(render(Header), testid))).toEqual(pages)
    })
  }

  it('shows the language as its short code and names it for screen readers', () => {
    const toggle = render(Header).match(
      /<button[^>]*data-testid="language-menu-toggle"[\s\S]*?<\/button>/,
    )?.[0]
    expect(toggle).toContain('>ES<')
    expect(toggle).toMatch(/sr-only[^>]*>[^<]*Español/)
  })

  it('keeps the donation link reachable from the footer', () => {
    const link = render(Footer).match(/<a[^>]*data-testid="footer-donate"[^>]*>/)?.[0]
    expect(link).toContain(`href="${DONATE_URL}"`)
  })
})
