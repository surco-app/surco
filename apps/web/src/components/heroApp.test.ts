import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { createI18n, LANGUAGES } from '../i18n'
import HeroApp from './HeroApp'

// The hero is the first thing a visitor reads, and it is the app itself: a recording in
// another language tells them, before any copy does, that the app is not in theirs.
describe('hero recording', () => {
  it.each(LANGUAGES)('shows the %s app in its own language', (lng) => {
    const html = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n: createI18n(lng) },
        createElement(HeroApp, { video: true }),
      ),
    )
    expect(html).toContain(`src="/hero-app-${lng}.webp"`)
    expect(html).toContain(`src="/hero-app-${lng}.webm"`)
    expect(html).toContain(`src="/hero-app-${lng}.mp4"`)
    for (const ext of ['webp', 'webm', 'mp4'])
      expect(
        existsSync(fileURLToPath(new URL(`../../public/hero-app-${lng}.${ext}`, import.meta.url))),
      ).toBe(true)
  })
})
