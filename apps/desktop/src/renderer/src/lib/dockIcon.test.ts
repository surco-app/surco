import { describe, expect, it } from 'vitest'
import { dockIconSvg, RESTING_WAVE_D, wavePathD } from './dockIcon'

function points(d: string): Array<[number, number]> {
  return d
    .replace(/^M /, '')
    .split(' L ')
    .map((pair) => {
      const [x, y] = pair.split(' ').map(Number)
      return [x, y]
    })
}

describe('wavePathD', () => {
  // The animated wave replaces the label's engraved squiggle, so it must span the
  // same horizontal run and never escape the label disc it sits on.
  it('spans the resting wave run and stays inside the label', () => {
    const pts = points(wavePathD(1.3))
    expect(pts[0][0]).toBe(431)
    expect(pts[pts.length - 1][0]).toBe(593)
    for (const [, y] of pts) {
      expect(y).toBeGreaterThanOrEqual(512 - 65)
      expect(y).toBeLessThanOrEqual(512 + 65)
    }
  })

  // A round-capped stroke cut mid-oscillation reads as a glitch; anchoring both
  // ends on the centerline makes every frame look like a deliberate squiggle.
  it('anchors both ends on the label centerline at every phase', () => {
    for (const phase of [0, 1, 2.5, 4, 5.5]) {
      const pts = points(wavePathD(phase))
      expect(pts[0][1]).toBe(512)
      expect(pts[pts.length - 1][1]).toBe(512)
    }
  })

  // Consecutive frames must actually differ or the dock animation freezes.
  it('renders a different curve for different phases', () => {
    expect(wavePathD(0)).not.toBe(wavePathD(Math.PI / 2))
  })
})

describe('dockIconSvg', () => {
  // Frames are rasterized from this SVG; the wave must inherit the static icon's
  // exact stroke so the animation reads as the icon coming alive, not a new glyph.
  it('embeds the given wave with the static icon stroke styling', () => {
    const svg = dockIconSvg(wavePathD(2))
    expect(svg).toContain(wavePathD(2))
    expect(svg).toContain('stroke="#0B1430"')
    expect(svg).toContain('stroke-width="16"')
  })

  // The resting frame restores the exact engraved squiggle from build/icon.svg, so
  // pausing leaves the dock showing the shipped icon and not an approximation.
  it('renders the resting icon from the original engraved path', () => {
    expect(dockIconSvg(RESTING_WAVE_D)).toContain(
      'M431 512 C 455 447, 479 447, 503 512 S 551 577, 575 512 L 593 512',
    )
  })
})
