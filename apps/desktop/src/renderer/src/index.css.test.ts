import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The dim/faint text tokens are used for hints and helper copy. WCAG 1.4.3 AA wants
// 4.5:1 for that small text against the surface it sits on (the panel is the dominant
// background), so this guards the palette from regressing below the threshold.
const css = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8')

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/--(color-[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2]
  return out
}

const split = css.indexOf('[data-theme="light"]')
const dark = tokens(css.slice(0, split))
const light = tokens(css.slice(split))

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// A translucent colour as the browser paints it over an opaque surface.
function blend(fg: string, bg: string, a: number): string {
  const f = parseInt(fg.slice(1), 16)
  const b = parseInt(bg.slice(1), 16)
  const ch = [16, 8, 0].map((s) => Math.round(((f >> s) & 255) * a + ((b >> s) & 255) * (1 - a)))
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

describe('theme text contrast (WCAG 1.4.3 AA)', () => {
  for (const [theme, t] of [
    ['dark', dark],
    ['light', light],
  ] as const) {
    for (const token of ['color-fg-dim', 'color-fg-faint']) {
      it(`${theme} ${token} reaches 4.5:1 on the panel background`, () => {
        expect(contrast(t[token], t['color-panel'])).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})

// The label on a FILLED surface — the primary CTA, the destructive confirm, the "applied"
// row. These read white in both themes until now, which quietly failed in dark: that
// palette's accent is a light blue (#7aa2f7) and its danger a light rose, so white on them
// measured ~2.5:1 — below even the relaxed 3:1 bar, on the most important button in the
// app. It passed unnoticed because the light palette's fills are dark, where white is
// correct. One theme-flipping token now carries the label, and the check runs over every
// filled surface it can land on, in both themes, so a future palette tweak can't reopen it.
describe('filled-surface label contrast (WCAG 1.4.3 AA)', () => {
  for (const [theme, t] of [
    ['dark', dark],
    ['light', light],
  ] as const) {
    for (const fill of ['color-accent', 'color-accent-hover', 'color-danger', 'color-good']) {
      it(`${theme} on-accent label reaches 4.5:1 on ${fill}`, () => {
        expect(contrast(t['color-on-accent'], t[fill])).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})

// Conversion progress on the selected row. The stage label and its sweep bar paint in
// --color-accent, which in the light palette is the SAME hex as --color-row-selected
// (#2959aa): the one row the DJ is watching — the track open in the editor — loses its
// progress entirely, reading as a stall while every other row animates. The .is-primary
// block already flips the right-hand glyphs for exactly this reason; the stage was missed.
// Guarding the token distance keeps a future palette edit from collapsing them again.
describe('selected-row progress affordances', () => {
  for (const [theme, t] of [
    ['dark', dark],
    ['light', light],
  ] as const) {
    // Why the accent can't stay: light collapses to 1.00 (identical hex) and dark reaches
    // only 2.12. The on-selection colour clears AA on both fills, which is why the fix is
    // to flip the affordance rather than to retune the accent.
    it(`${theme} on-selection colour reaches 4.5:1 on the selected row fill`, () => {
      expect(contrast(t['color-on-row-selected'], t['color-row-selected'])).toBeGreaterThanOrEqual(
        4.5,
      )
    })
  }

  for (const testid of ['track-stage', 'track-quality-loading']) {
    it(`flips ${testid} to the on-selection colour`, () => {
      const block = css.slice(css.indexOf('.is-primary'))
      expect(block).toContain(`.is-primary [data-testid="${testid}"]`)
    })
  }
})

// The focus ring is the only thing that shows a keyboard user where they are on every
// button, and it was the accent at 32% over the panel: 1.8:1 in dark and 1.6:1 in light,
// a glow you had to hunt for. WCAG 1.4.11 wants 3:1 for a focus indicator against what
// surrounds it, so the ring is measured as it lands on the surfaces controls sit on,
// with any color-mix blended over that surface the way the browser paints it.
describe('focus ring contrast (WCAG 1.4.11)', () => {
  const ring = css.match(/--ring:\s*([^;]+);/)?.[1] ?? ''
  const mix = ring.match(/color-mix\(in srgb, var\(--color-accent\) (\d+)%, transparent\)/)
  const alpha = mix ? Number(mix[1]) / 100 : 1

  it('paints the ring in the accent', () => {
    expect(ring).toContain('var(--color-accent)')
  })

  for (const [theme, t] of [
    ['dark', dark],
    ['light', light],
  ] as const) {
    for (const surface of ['color-panel', 'color-panel-2']) {
      it(`${theme} ring reaches 3:1 on ${surface}`, () => {
        const painted = blend(t['color-accent'], t[surface], alpha)
        expect(contrast(painted, t[surface])).toBeGreaterThanOrEqual(3)
      })
    }
  }
})

// The border is what tells a text field or a slider track apart from the panel around it,
// and --color-line (a separator) measured 1.22:1 in dark and 1.27:1 in light; even
// --color-line-strong only reached 1.46 and 1.58. WCAG 1.4.11 wants 3:1 for the boundary
// that identifies a control, so fields and tracks get their own token, measured on every
// surface they sit on, while the faint line stays for the separators it was made for.
describe('control border contrast (WCAG 1.4.11)', () => {
  for (const [theme, t] of [
    ['dark', dark],
    ['light', light],
  ] as const) {
    for (const surface of ['color-panel', 'color-panel-2', 'color-field']) {
      it(`${theme} input border reaches 3:1 on ${surface}`, () => {
        expect(contrast(t['color-input-border'], t[surface])).toBeGreaterThanOrEqual(3)
      })
    }
  }

  it('draws the volume and fade slider track in the control border', () => {
    const track = css.slice(css.indexOf('.player-volume-range::-webkit-slider-runnable-track'))
    expect(track.slice(0, track.indexOf('}'))).toContain('var(--color-input-border)')
  })
})

// The section header pills are a dot and a label on the bare panel, no wash. Warn and
// danger print the label itself in the tone colour so a problem reads before the dot is
// found, which makes those two colours body text on the panel: they have to clear AA there,
// in both themes, or the one pill that asks for attention is the hardest to read.
describe('section pill label contrast (WCAG 1.4.3 AA)', () => {
  const pill = readFileSync(
    fileURLToPath(new URL('./components/SectionPill.tsx', import.meta.url)),
    'utf8',
  )
  for (const tone of ['warn', 'danger']) {
    for (const [theme, t] of [
      ['dark', dark],
      ['light', light],
    ] as const) {
      it(`${theme} ${tone} pill label reaches 4.5:1 on the panel`, () => {
        expect(pill).toContain(`${tone}: 'text-[var(--color-${tone})]'`)
        expect(contrast(t[`color-${tone}`], t['color-panel'])).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})

// The trim handle opts out of the global ring (a box around a 12px-wide strip read as a
// stray rectangle) and used to show focus only as a soft glow on a 1px line: nothing a
// keyboard user could find at a glance. Focus now rings the grip with a solid 2px accent
// band, kept off the grip by a 2px moat of the lane colour so it reads as a ring and not
// as a fatter grip, and that band has to clear 3:1 against the lane it is drawn on.
describe('trim handle focus indicator (WCAG 1.4.11)', () => {
  const rule = css.slice(css.indexOf('.trim-handle[data-focused] .trim-grip'))
  const body = rule.slice(0, rule.indexOf('}'))

  it('rings the grip with a solid 2px accent band outside a lane-coloured gap', () => {
    expect(body).toContain('0 0 0 2px var(--color-field)')
    expect(body).toContain('0 0 0 4px var(--color-accent)')
  })

  for (const [theme, t] of [
    ['dark', dark],
    ['light', light],
  ] as const) {
    it(`${theme} ring reaches 3:1 on the lane`, () => {
      expect(contrast(t['color-accent'], t['color-field'])).toBeGreaterThanOrEqual(3)
    })
  }
})

// Motion someone has asked the OS to reduce kept running: every spinner and pulse (they
// are Tailwind utilities, spread over components that each forgot), the player's height
// tween that Player.tsx promised was neutralised here, the press scale on nearly every
// button, and the toast countdown sliding its bar across. Each has to appear inside a
// reduced-motion block, and the countdown still has to tell time, by fading instead.
describe('reduced motion', () => {
  const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{/g)]
    .map((m) => {
      let depth = 0
      for (let i = (m.index ?? 0) + m[0].length - 1; i < css.length; i++) {
        if (css[i] === '{') depth++
        if (css[i] === '}' && --depth === 0) return css.slice(m.index, i + 1)
      }
      return ''
    })
    .join('\n')

  for (const selector of [
    '.animate-spin',
    '.animate-pulse',
    '.player-section',
    '.press',
    '.animate-toast-countdown',
  ]) {
    it(`holds ${selector} still`, () => {
      expect(reduced).toContain(selector)
    })
  }

  it('drains the toast countdown by fading rather than sliding', () => {
    expect(reduced).toMatch(/\.animate-toast-countdown\s*\{[^}]*toast-countdown-fade/)
    const frames = css.slice(css.indexOf('@keyframes toast-countdown-fade'))
    expect(frames.slice(0, frames.indexOf('}\n}'))).toContain('opacity')
  })
})

// The zoom ruler's time labels were 9px, the smallest text in the app, sitting on the
// busiest ground in it; 10px is the least that reads there.
describe('waveform ruler labels', () => {
  it('sets the label no smaller than 10px', () => {
    const rule = css.slice(css.indexOf('.wave-label {'))
    const size = rule.slice(0, rule.indexOf('}')).match(/font-size:\s*(\d+)px/)
    expect(Number(size?.[1])).toBeGreaterThanOrEqual(10)
  })
})
