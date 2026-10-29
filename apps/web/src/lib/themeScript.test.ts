import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { THEME_KEY } from './theme'

const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8')
const head = html.slice(0, html.indexOf('</head>'))
const inline = head.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''

type Page = { theme?: string; themeColor: string | null }

function load({
  stored,
  systemDark,
  storageThrows = false,
}: {
  stored: string | null
  systemDark: boolean
  storageThrows?: boolean
}): Page {
  const meta = { content: '#1a1b26' as string | null }
  const documentElement = { dataset: {} as Record<string, string> }
  const document = {
    documentElement,
    querySelector: (sel: string) => (sel === 'meta[name="theme-color"]' ? meta : null),
  }
  const localStorage = {
    getItem: (key: string) => {
      if (storageThrows) throw new Error('blocked')
      return key === THEME_KEY ? stored : null
    },
  }
  const matchMedia = (q: string) => ({
    matches: q === '(prefers-color-scheme: dark)' ? systemDark : !systemDark,
  })
  new Function('document', 'localStorage', 'matchMedia', inline)(document, localStorage, matchMedia)
  return { theme: documentElement.dataset.theme, themeColor: meta.content }
}

// The prerendered HTML ships before React, so the theme has to be on <html> before the
// first paint; set later, a light visitor would see the dark page flash first.
describe('theme script in the HTML head', () => {
  it('runs inline, before the stylesheet and the app load', () => {
    expect(inline).not.toBe('')
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('<script type="module"'))
  })

  it('keeps the theme the visitor chose with the sun over the system one', () => {
    expect(load({ stored: 'light', systemDark: true }).theme).toBe('light')
    expect(load({ stored: 'dark', systemDark: false }).theme).toBe('dark')
  })

  it('follows the system until the visitor chooses', () => {
    expect(load({ stored: null, systemDark: false }).theme).toBe('light')
    expect(load({ stored: null, systemDark: true }).theme).toBe('dark')
  })

  it('still themes the page when storage is blocked, as in a private window', () => {
    expect(load({ stored: null, systemDark: false, storageThrows: true }).theme).toBe('light')
  })

  it('tints the browser bar with the light ground, not the dark one', () => {
    expect(load({ stored: 'light', systemDark: true }).themeColor).toBe('#e6e7ed')
    expect(load({ stored: 'dark', systemDark: true }).themeColor).toBe('#1a1b26')
  })
})
