import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { loadI18n } from '../i18n'
import Guide from './Guide'
import Privacy from './Privacy'
import Stats from './Stats'

const i18n = await loadI18n('en', { releases: true })

const html = (component: Parameters<typeof createElement>[0]) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(component)))

describe('reading-progress bar', () => {
  it('stays off the pages that are not meant to be read top to bottom', () => {
    for (const page of [App, Privacy, Stats])
      expect(html(page), page.name).not.toContain('data-testid="scroll-progress"')
  })

  it('stays on the guide, which is read top to bottom', () => {
    expect(html(Guide)).toContain('data-testid="scroll-progress"')
  })
})
