import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { LANGUAGES, loadI18n } from '../i18n'
import HeroApp from './HeroApp'

const I18N = Object.fromEntries(
  await Promise.all(LANGUAGES.map(async (lng) => [lng, await loadI18n(lng)] as const)),
)

const publicFile = (name: string) => fileURLToPath(new URL(`../../public/${name}`, import.meta.url))

const webpWidth = (name: string) => readFileSync(publicFile(name)).readUInt16LE(26) & 0x3fff

// The hero is the first thing a visitor reads, and it is the app itself: a recording in
// another language tells them, before any copy does, that the app is not in theirs.
describe('hero recording', () => {
  it.each(LANGUAGES)('shows the %s app in its own language', (lng) => {
    const html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n: I18N[lng] }, createElement(HeroApp, { video: true })),
    )
    expect(html).toContain(`src="/hero-app-${lng}.webp"`)
    expect(html).toContain(`src="/hero-app-${lng}.webm"`)
    expect(html).toContain(`src="/hero-app-${lng}.mp4"`)
    for (const ext of ['webp', 'webm', 'mp4'])
      expect(
        existsSync(fileURLToPath(new URL(`../../public/hero-app-${lng}.${ext}`, import.meta.url))),
      ).toBe(true)
  })

  it.each(LANGUAGES)('lets a phone download a %s still sized for its screen', (lng) => {
    const html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n: I18N[lng] }, createElement(HeroApp)),
    )
    const variants = [800, 1200]
    expect(html).toContain(
      `srcSet="${variants.map((w) => `/hero-app-${lng}-${w}.webp ${w}w`).join(', ')}, /hero-app-${lng}.webp 2000w"`,
    )
    expect(html).toContain('sizes="')
    for (const w of variants) expect(webpWidth(`hero-app-${lng}-${w}.webp`)).toBe(w)
    expect(webpWidth(`hero-app-${lng}.webp`)).toBe(2000)
  })

  it.each(LANGUAGES)('never makes a %s phone fetch the full-size still for the loop', (lng) => {
    const html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n: I18N[lng] }, createElement(HeroApp, { video: true })),
    )
    expect(html).not.toContain('poster=')
  })
})
