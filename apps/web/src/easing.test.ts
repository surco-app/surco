import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import Header from './components/Header'
import { loadI18n } from './i18n'

const css = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8')
const CURVE = 'cubic-bezier(0.22, 1, 0.36, 1)'
const i18n = await loadI18n('en')

const header = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(Header)))

const tag = (testId: string) =>
  new RegExp(`<[a-z]+ [^>]*data-testid="${testId}"[^>]*>`).exec(header)?.[0] ?? ''

describe('the strong ease-out curve', () => {
  it('never redeclares --ease-out, which would retune every ease-out utility on the site', () => {
    expect(css).not.toMatch(/--ease-out\s*:/)
  })

  it('is declared once on :root and nowhere else spelled out', () => {
    expect(css).toMatch(/:root\s*\{[^}]*--ease-strong:\s*cubic-bezier\(0\.22, 1, 0\.36, 1\)/)
    expect(css.split(CURVE)).toHaveLength(2)
  })

  it('drives the label pop and the language offer instead of the weak built-in ease-out', () => {
    expect(/animation:\s*labelPop [^;]*var\(--ease-strong\)/.test(css)).toBe(true)
    expect(/animation:\s*offerIn [^;]*var\(--ease-strong\)/.test(css)).toBe(true)
    expect(css).not.toMatch(/animation:[^;]*\sease-out/)
  })

  it('drives the language menu and the mobile menu transitions', () => {
    for (const id of ['language-menu', 'header-mobile-nav']) {
      expect(tag(id), id).toContain('ease-(--ease-strong)')
      expect(tag(id).split(/\s+/), id).not.toContain('ease-out')
    }
  })
})
