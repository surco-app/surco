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
