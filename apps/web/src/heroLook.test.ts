// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import App from './App'
import { loadI18n } from './i18n'

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
