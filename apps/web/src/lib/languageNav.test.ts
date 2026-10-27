import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import Header from '../components/Header'
import { createI18n, type Language } from '../i18n'
import { recipePages } from './useCases'

function header(lang: Language, page?: 'guide' | 'useCases', id?: string) {
  const alternates = id
    ? recipePages().find((recipe) => recipe.lang === lang && recipe.id === id)?.alternates
    : undefined
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: createI18n(lang) },
      createElement(Header, { page, alternates }),
    ),
  )
}

describe('language navigation', () => {
  it('keeps the existing Spanish and English destinations and offers Japanese', () => {
    expect(header('es')).toContain('href="/en"')
    expect(header('es')).toContain('href="/ja"')
    expect(header('en', 'guide')).toContain('href="/guia"')
    expect(header('en', 'guide')).toContain('href="/ja/guide"')
  })

  it('links Japanese pages to their matching Spanish and English pages', () => {
    expect(header('ja', 'guide')).toContain('href="/guia"')
    expect(header('ja', 'guide')).toContain('href="/en/guide"')
    expect(header('ja', 'guide')).toContain('href="/ja#como"')
  })

  it('switches recipes by id across all three languages', () => {
    const html = header('ja', 'useCases', 'nas')
    expect(html).toContain('href="/casos-de-uso/musica-en-un-nas"')
    expect(html).toContain('href="/en/use-cases/music-on-a-nas"')
    expect(html).toContain('href="/ja/guide"')
  })
})
