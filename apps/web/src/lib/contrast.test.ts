import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8')
const app = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8')

function token(name: string): string {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`missing token --color-${name}`)
  return m[1]
}

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

// Fading a token with /NN composites it against the page background, which lowers the
// real contrast — the ratio the token was chosen for no longer applies.
function fade(fg: string, bg: string, alpha: number): string {
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [f, b] = [parse(fg), parse(bg)]
  return `#${f
    .map((v, i) =>
      Math.round(v * alpha + b[i] * (1 - alpha))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

describe('body text contrast (WCAG 1.4.3 AA)', () => {
  for (const name of ['faint', 'muted']) {
    it(`${name} clears 4.5:1 on the page background`, () => {
      expect(contrast(token(name), token('bg'))).toBeGreaterThanOrEqual(4.5)
    })
  }

  // The safety note under the install command is the one line that tells the reader
  // re-exporting to the same format rewrites the original in place — the sentence that
  // stands between them and an overwritten master. It was dimmed with /80, which drops it
  // to 3.80:1 and lands it back on the very colour index.css records as failing AA. Small
  // mono text carrying a data-loss warning is the last thing that should be faded.
  it('does not fade the overwrite warning below AA', () => {
    const safety = app.match(/className="([^"]*)"[^>]*>\s*\{t\('home\.closeSafety'\)\}/)
    expect(safety, 'closeSafety paragraph not found').not.toBeNull()
    const faded = safety?.[1].match(/text-(faint|muted)\/(\d+)/)
    if (faded) {
      const ratio = contrast(
        fade(token(faded[1]), token('bg'), Number(faded[2]) / 100),
        token('bg'),
      )
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    }
  })
})
