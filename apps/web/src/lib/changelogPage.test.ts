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

const patchLabels = (html: string) =>
  [...html.matchAll(/data-testid="changelog-patch"[^>]*>v([\d.]+)</g)].map((m) => m[1])

const patchesOf = (release: (typeof releasesEs)[number]) => [
  ...new Set(
    release.items
      .map((item) => (typeof item === 'string' ? null : item.in))
      .filter((v): v is string => v !== null && !v.endsWith('.0')),
  ),
]

describe('changelog page', () => {
  it('labels every patch that brought something, so a reader can see what each update carried', () => {
    const expected = releasesEs.flatMap(patchesOf).sort()
    expect(expected.length).toBeGreaterThan(0)
    expect(patchLabels(render('es')).sort()).toEqual(expected)
  })

  it('shows the patches of the newest release oldest first, below what the minor shipped with', () => {
    const newestWithPatches = releasesEs.find((r) => patchesOf(r).length > 1)
    if (!newestWithPatches) throw new Error('no release with several patches')
    const html = render('es')
    const positions = patchesOf(newestWithPatches)
      .sort((a, b) => Number(a.split('.')[2]) - Number(b.split('.')[2]))
      .map((v) => html.indexOf(`>v${v}<`))
    expect(positions.every((p) => p > -1)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

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
