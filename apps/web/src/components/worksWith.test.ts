import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { createI18n, LANGUAGES } from '../i18n'
import WorksWith from './WorksWith'

const render = (lng: (typeof LANGUAGES)[number]) =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n: createI18n(lng) }, createElement(WorksWith)),
  )

const group = (html: string, testId: string) =>
  html.match(new RegExp(`data-testid="${testId}"[\\s\\S]*?</div>`))?.[0] ?? ''

// One row mixing Discogs with rekordbox reads as nine peers, and a visitor can't tell
// that the first ones fill the tags while the rest are where the tracks end up.
describe('works with', () => {
  it('keeps the metadata sources apart from the programs the tracks go to', () => {
    const html = render('en')
    const sources = group(html, 'works-with-sources')
    const programs = group(html, 'works-with-programs')
    for (const name of ['Discogs', 'Bandcamp', 'Deezer', 'Beatport', 'MusicBrainz']) {
      expect(sources).toContain(name)
      expect(programs).not.toContain(name)
    }
    for (const name of [
      'rekordbox',
      'Traktor',
      'Engine DJ',
      'Serato',
      'VirtualDJ',
      'Apple Music',
    ]) {
      expect(programs).toContain(name)
      expect(sources).not.toContain(name)
    }
  })

  it.each(LANGUAGES)('names both groups in %s', (lng) => {
    const i18n = createI18n(lng)
    const html = render(lng)
    expect(group(html, 'works-with-sources')).toContain(i18n.t('home.worksWithSources'))
    expect(group(html, 'works-with-programs')).toContain(i18n.t('home.worksWithPrograms'))
  })
})
