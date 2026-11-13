import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { HeroStatsView } from '../components/HeroStats'
import { loadI18n } from '../i18n'
import { PAGES } from './nav'
import type { Stats } from './stats'

const stats: Stats = {
  days: [
    { date: '2026-11-01', mac: 300, windows: 800, linux: 100 },
    { date: '2026-11-04', mac: 335, windows: 845, linux: 114 },
    { date: '2026-11-11', mac: 371, windows: 928, linux: 197 },
  ],
  macUpdates: [],
}

const es = await loadI18n('es')

const render = (s: Stats) =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n: es }, createElement(HeroStatsView, { stats: s })),
  )

const text = (html: string, testid: string) =>
  html.match(new RegExp(`data-testid="${testid}"[^>]*>([^<]*)<`))?.[1]

// The stats page was only reachable from the footer, so nobody found it. The hero shows the
// same headline figure the page opens with, right under the download, and links there.
describe('hero stats', () => {
  it('shows the same total the stats page heads with, thousands grouped', () => {
    expect(text(render(stats), 'hero-stats-total')).toBe('1.496')
  })

  it('counts the Mac installs of the last seven days, the page’s measure of new people', () => {
    expect(text(render(stats), 'hero-stats-week')).toBe('+36')
  })

  // A quiet week would read as "nobody downloads this" right next to the download button.
  it('leaves the weekly figure out when the week brought no installs', () => {
    const flat = {
      ...stats,
      days: stats.days.map((d) => ({ ...d, mac: 371 })),
    }
    expect(render(flat)).not.toContain('hero-stats-week')
  })

  it('links the stats page', () => {
    expect(render(stats)).toMatch(
      new RegExp(`href="${PAGES.stats.es}"[^>]*data-testid="hero-stats-link"`),
    )
  })
})
