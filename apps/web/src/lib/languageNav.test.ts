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
    expect(header('ja', 'guide')).toContain('href="/ja#instalar"')
  })

  it('links every page to the same page in German, French and Portuguese', () => {
    const html = header('es', 'guide')
    expect(html).toContain('href="/de/guide"')
    expect(html).toContain('href="/fr/guide"')
    expect(html).toContain('href="/pt/guide"')
    expect(header('de', 'guide')).toContain('href="/de#instalar"')
    expect(header('pt-BR', 'useCases', 'nas')).toContain('href="/fr/use-cases/music-on-a-nas"')
  })

  it('switches recipes by id across every language', () => {
    const html = header('ja', 'useCases', 'nas')
    expect(html).toContain('href="/casos-de-uso/musica-en-un-nas"')
    expect(html).toContain('href="/en/use-cases/music-on-a-nas"')
    expect(html).toContain('href="/ja/guide"')
  })

  // One menu holds every language, so each must be readable by someone who doesn't
  // read the page's: the names stay in their own script whatever page lists them.
  it('names every language in its own words on every page', () => {
    for (const lang of ['es', 'en', 'de', 'fr', 'pt-BR', 'ja'] as const) {
      const html = header(lang)
      for (const name of ['Español', 'English', 'Deutsch', 'Français', 'Português', '日本語'])
        expect(html).toContain(`>${name}<`)
    }
  })

  it('marks the language being read', () => {
    expect(header('ja')).toMatch(/<a [^>]*aria-current="true"[^>]*>(?:(?!<\/a>).)*日本語/)
    expect(header('es')).not.toMatch(/<a [^>]*aria-current="true"[^>]*>(?:(?!<\/a>).)*日本語/)
  })

  // The menu starts closed but its links ship in the prerendered HTML, so crawlers and
  // readers without scripts still reach the other languages.
  it('ships a closed menu whose links are in the prerendered page', () => {
    const html = header('es')
    expect(html).toMatch(/<button [^>]*aria-expanded="false"[^>]*aria-controls="language-menu"/)
    expect(html).toMatch(/id="language-menu"(?:(?!<\/ul>).)*hrefLang="ja"/)
  })
})
