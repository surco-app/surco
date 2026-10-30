import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import Footer from '../components/Footer'
import { StatsView } from '../components/Stats'
import { createI18n } from '../i18n'
import { PAGES } from './nav'
import type { Stats } from './stats'

const stats: Stats = {
  days: [
    { date: '2026-06-02', mac: 4, windows: 3, linux: 0, estimated: true },
    { date: '2026-10-29', mac: 272, windows: 750, linux: 77, estimated: true },
    { date: '2026-10-30', mac: 273, windows: 757, linux: 78 },
  ],
  macUpdates: [
    { version: 'v1.17.0', count: 4 },
    { version: 'v1.16.0', count: 8 },
  ],
}

function render<P extends object>(node: (props: P) => ReactNode, props: P): string {
  return renderToStaticMarkup(
    createElement(I18nextProvider, { i18n: createI18n('es') }, createElement(node, props)),
  )
}

const text = (html: string, testid: string) => {
  const match = html.match(new RegExp(`data-testid="${testid}"[^>]*>([^<]*)<`))
  expect(match, `${testid} not found`).not.toBeNull()
  return match?.[1]
}

// The footer's bare number summed bot fetches and Windows and Linux updates, so it climbed
// with every release whether anyone new arrived or not. The figures live on their own
// page now, where each one says what it counts.
describe('footer', () => {
  it('links the stats page instead of showing a download count', () => {
    const html = render(Footer, {})
    expect(html).not.toContain('download-count')
    expect(html).toMatch(new RegExp(`href="${PAGES.stats.es}"[^>]*data-testid="footer-stats"`))
  })
})

describe('stats page', () => {
  it('heads with the three systems added up on the latest day', () => {
    expect(text(render(StatsView, { stats }), 'stats-total')).toBe('1.108')
  })

  // Spanish leaves four-digit numbers ungrouped by default, which reads as a year next to
  // the five-digit ones that will follow.
  it('groups thousands in every figure', () => {
    const big = { ...stats, days: [{ date: '2026-10-30', mac: 1200, windows: 0, linux: 0 }] }
    expect(text(render(StatsView, { stats: big }), 'stats-mac')).toBe('1.200')
  })

  it('says from which day the history stops being a reconstruction', () => {
    expect(text(render(StatsView, { stats }), 'stats-measured-since')).toContain('30 de octubre')
  })

  it('lists the Mac updates per version, newest first', () => {
    const html = render(StatsView, { stats })
    expect(html.indexOf('v1.17.0')).toBeLessThan(html.indexOf('v1.16.0'))
  })
})
