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
