// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import App from './App'
import { HeroStatsView } from './components/HeroStats'
import { loadI18n } from './i18n'
import type { Stats } from './lib/stats'

const css = readFileSync(join(import.meta.dirname, 'index.css'), 'utf8')
const i18n = await loadI18n('es')
const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(App)))
const doc = new DOMParser().parseFromString(html, 'text/html')
const visual = doc.querySelector('[data-testid="hero-visual"]')

describe('hero, as Cuts and Nada draw it', () => {
  it('sets the product on flat ground, since neither sibling lights a glow behind its hero', () => {
    expect(visual).not.toBeNull()
    expect(visual?.children).toHaveLength(1)
    expect(css).not.toMatch(/radial-gradient/)
  })
})

describe('hero screenshot', () => {
  const frame = doc.querySelector('[data-testid="hero-frame"]')
  const column = (el: Element | null) =>
    (el?.className ?? '').split(/\s+/).filter((c) => /^(sm:)?(max-w-|px-)/.test(c))

  it('stays inside the column the header sets, instead of breaking out past the logo and the menu', () => {
    const header = doc.querySelector('header > div')
    const section = visual?.closest('section') ?? null
    expect(column(section)).toEqual(column(header))
    for (let el = visual; el && el !== section; el = el.parentElement)
      expect(el.className).not.toMatch(/(^|\s)(-m[xlr]-|w-\[|w-screen)/)
  })

  it('wears the rounded hairline and soft drop shadow Cuts frames its screenshots in', () => {
    const classes = (frame?.className ?? '').split(/\s+/)
    expect(classes).toContain('rounded-xl')
    expect(classes).toContain('ring-line')
    expect(frame?.className).toMatch(/shadow-\[[^\]]*var\(--color-shade\)/)
  })
})

describe('hero type and small print', () => {
  const stats: Stats = {
    days: [
      { date: '2026-11-01', mac: 300, windows: 400 },
      { date: '2026-11-11', mac: 330, windows: 430 },
    ],
    versions: [],
    usage: [],
  }
  const pill = new DOMParser().parseFromString(
    renderToStaticMarkup(
      createElement(I18nextProvider, { i18n }, createElement(HeroStatsView, { stats })),
    ),
    'text/html',
  )
  const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)

  it('sets the headline at the size, weight and tracking of Cuts and Nada', () => {
    const h1 = classes(doc.querySelector('h1'))
    for (const utility of ['font-semibold', 'tracking-tight', 'sm:text-5xl', 'max-w-2xl'])
      expect(h1).toContain(utility)
    expect(h1.join(' ')).not.toMatch(/font-bold|lg:text-/)
  })

  it('draws the stats pill in the family grays, an outline with ink figures and an ink link', () => {
    const box = pill.querySelector('[data-testid="hero-stats-pill"]')
    expect(classes(box)).toContain('border-line')
    expect(classes(box).some((c) => c.startsWith('bg-'))).toBe(false)
    expect(classes(pill.querySelector('[data-testid="hero-stats-week"]'))).toContain('text-fg')
    expect(classes(pill.querySelector('[data-testid="hero-stats-link"]'))).toContain('text-fg')
    expect(box?.outerHTML).not.toMatch(/text-(blue|green|cyan)/)
  })

  it("keeps Surco blue for the release label alone, set in mono like the family's version line", () => {
    const release = doc.querySelector('[data-testid="latest-release"]')
    const label = doc.querySelector('[data-testid="latest-release-label"]')
    expect(classes(label)).toContain('text-blue')
    expect(classes(label)).toContain('font-mono')
    const accented = [...(release?.querySelectorAll('*') ?? [])].filter((el) =>
      classes(el).includes('text-blue'),
    )
    expect(accented).toEqual([label])
  })
})
