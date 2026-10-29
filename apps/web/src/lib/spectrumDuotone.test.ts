import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LIGHT_SPECTRUM_RAMP } from './spectrumDuotone'

const root = fileURLToPath(new URL('..', import.meta.url))
const css = readFileSync(join(root, 'index.css'), 'utf8')
const light = css.slice(css.indexOf('[data-theme="light"]'))

function token(name: string, from: string): number[] {
  const hex = from.match(new RegExp(`--color-${name}:\\s*#([0-9a-fA-F]{6})`))?.[1] ?? ''
  const n = Number.parseInt(hex, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Number((v / 255).toFixed(4)))
}

const ends = (table: string) => {
  const values = table.split(' ').map(Number)
  return [values[0], values[values.length - 1]]
}

// The spectrum images are rendered dark: on the light page they were a black slab, the
// loudest thing on screen. The app recolors its spectrogram through a ramp built from the
// theme, so in light silence melts into the panel and the music climbs through the accent.
// The site uses the app's own ramp, but ends it in the page's ink rather than amber: its
// images are colored for the dark page and their whole low band is near white, so ending in
// the light palette's amber turned that band into a strip of mud. Surco's charts are accent
// and ink; amber is kept for states.
describe('spectrum on the light page', () => {
  it('starts the ramp at the page ground and ends it in the ink, never in amber', () => {
    const [ground, ink] = [token('spectrum', light), token('fg', light)]
    expect(token('spectrum', light)).toEqual(token('bg', light))
    const channels = [LIGHT_SPECTRUM_RAMP.r, LIGHT_SPECTRUM_RAMP.g, LIGHT_SPECTRUM_RAMP.b]
    channels.forEach((table, i) => {
      expect(ends(table)).toEqual([ground[i], ink[i]])
    })
  })

  it('recolors the spectrum only in light, leaving the dark page as it was', () => {
    expect(css).toMatch(
      /:root\[data-theme="light"\] \.spectrum-duotone \{[^}]*filter: url\(#spectrum-duotone\)/,
    )
    expect(css).not.toMatch(/^\.spectrum-duotone/m)
  })

  for (const file of (
    readdirSync(join(root, 'components'), { recursive: true }) as string[]
  ).filter((f) => f.endsWith('.tsx'))) {
    const code = readFileSync(join(root, 'components', file), 'utf8')
    const images = [...code.matchAll(/<img\b[^>]*?\/spectrum\/[\s\S]*?\/>/g)].map((m) => m[0])
    if (images.length === 0) continue
    it(`${file} draws its spectra through the duotone`, () => {
      for (const img of images) expect(img).toContain('spectrum-duotone')
      expect(code).toContain('<SpectrumDuotone')
    })
  }
})
