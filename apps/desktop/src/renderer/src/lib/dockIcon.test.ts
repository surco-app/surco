import { describe, expect, it } from 'vitest'
import { dockIconSvg, RESTING_WAVE_D } from './dockIcon'

describe('dockIconSvg', () => {
  // A record turns by rotating its label, not by redrawing the
  // engraving: a real LP shows the same squiggle coming round, it never morphs.
  it('keeps the engraved wave static and spins the disc by the given angle', () => {
    const still = dockIconSvg(0)
    const turned = dockIconSvg(90)
    // The engraving is identical in every frame...
    expect(still).toContain(RESTING_WAVE_D)
    expect(turned).toContain(RESTING_WAVE_D)
    // ...only the disc's rotation advances.
    expect(still).toContain('rotate(0 512 512)')
    expect(turned).toContain('rotate(90 512 512)')
  })

  // Fixed lighting reads as natural: the tile frame and the disc's lit edge must not
  // travel with the spin, so the rotation wraps only the label and wave.
  it('leaves the tile frame outside the spinning group', () => {
    const svg = dockIconSvg(120)
    expect(svg.indexOf('url(#tile)')).toBeLessThan(svg.indexOf('rotate('))
  })

  // The disc's edge is lit from above so it parts from the navy tile at small sizes. A
  // highlight that travelled with the spin would make the record wobble, not turn.
  it('keeps the lit edge of the disc outside the spinning group', () => {
    const svg = dockIconSvg(120)
    expect(svg).toContain('stroke="url(#rim)"')
    expect(svg.indexOf('stroke="url(#rim)"')).toBeLessThan(svg.indexOf('rotate('))
  })

  // The resting frame restores the exact engraved squiggle from build/icon.svg at no
  // rotation, so pausing leaves the dock showing the shipped icon, not an approximation.
  it('renders the resting icon unrotated from the original engraved path', () => {
    expect(dockIconSvg(0)).toContain(
      'M423 512 C 449 440, 476 440, 502 512 S 555 584, 581 512 L 601 512',
    )
  })

  // Frames are rasterized from this SVG; the wave keeps the static icon's exact stroke
  // so the animation reads as the icon spinning, not a new glyph.
  it('embeds the engraving with the static icon stroke styling', () => {
    const svg = dockIconSvg(45)
    expect(svg).toContain('stroke="#0B1430"')
    expect(svg).toContain('stroke-width="20"')
  })
})
