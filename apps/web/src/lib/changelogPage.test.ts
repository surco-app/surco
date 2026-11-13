import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import Changelog from '../components/Changelog'
import { LANGUAGES, loadI18n } from '../i18n'
import releasesEs from '../i18n/changelog/es.json'

const I18N = Object.fromEntries(
  await Promise.all(
    LANGUAGES.map(async (lng) => [lng, await loadI18n(lng, { releases: true })] as const),
  ),
)

const render = (lng: (typeof LANGUAGES)[number]) =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n: I18N[lng] }, createElement(Changelog)),
  )

const latestBlock = (html: string) => {
  const start = html.indexOf('data-testid="changelog-latest"')
  expect(start, 'newest release not found').toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</section>', start))
}

describe('changelog page', () => {
  it('opens on the newest release', () => {
    expect(latestBlock(render('es'))).toContain(`v${releasesEs[0].version}`)
  })

  it.each(LANGUAGES)(
    'paints the newest %s release in the static page instead of waiting for the script to fade it in',
    (lng) => {
      expect(latestBlock(render(lng))).not.toContain('reveal-init')
    },
  )
})
