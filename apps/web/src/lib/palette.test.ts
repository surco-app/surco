import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8')

// A translucent colour as the browser paints it over an opaque surface.
function blend(fg: string, bg: string, a: number): string {
  const f = parseInt(fg.slice(1), 16)
  const b = parseInt(bg.slice(1), 16)
  const ch = [16, 8, 0].map((s) => Math.round(((f >> s) & 255) * a + ((b >> s) & 255) * (1 - a)))
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function hex(r: string, g: string, b: string): string {
  return `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`
}

// Every colour on the site is Tokyo Night, like the desktop app: a colour of the palette as
// it ships, or a blend of two of them (Vicent 25/09). The page ground is Tokyo Night Night,
// the app's own palette. The raised surfaces keep Storm's two grounds: Storm is the same
// family, and Night has nothing between its bg and bg_highlight for a card to sit on.
const TOKYO_NIGHT = {
  bg_dark1: '#0c0e14',
  bg_dark: '#16161e',
  bg: '#1a1b26',
  storm_bg_dark: '#1f2335',
  storm_bg: '#24283b',
  bg_highlight: '#292e42',
  fg_gutter: '#3b4261',
  dark5: '#737aa2',
  markdown_text: '#9aa5ce',
  fg_dark: '#a9b1d6',
  fg: '#c0caf5',
  blue: '#7aa2f7',
  cyan: '#7dcfff',
  magenta: '#bb9af7',
  green: '#9ece6a',
  yellow: '#e0af68',
  orange: '#ff9e64',
  red: '#f7768e',
} as const

type Colour = keyof typeof TOKYO_NIGHT

const BLENDS: Record<string, [Colour, number, Colour]> = {
  'color-line': ['bg_highlight', 70, 'fg_gutter'],
  'color-faint': ['dark5', 70, 'fg_dark'],
}

const palette = new Set<string>(Object.values(TOKYO_NIGHT))

describe('Tokyo Night palette', () => {
  const theme = css.slice(css.indexOf('@theme'), css.indexOf('\n}', css.indexOf('@theme')))

  for (const m of theme.matchAll(/--(color-[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    const [, token, value] = m
    it(`${token} is a Tokyo Night colour or a blend of two`, () => {
      const mix = BLENDS[token]
      if (mix)
        expect(value.toLowerCase()).toBe(
          blend(TOKYO_NIGHT[mix[0]], TOKYO_NIGHT[mix[2]], mix[1] / 100),
        )
      else expect(palette).toContain(value.toLowerCase())
    })
  }

  // The rules below the tokens name colours too: the page ground, the text selection, the
  // headline glow. A literal there is a palette colour or a tint of one.
  it('paints nothing in index.css outside the palette', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const hexes = [...code.matchAll(/#([0-9a-fA-F]{6})\b/g)].map((m) => `#${m[1]}`.toLowerCase())
    const rgbs = [...code.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)].map((m) =>
      hex(m[1], m[2], m[3]),
    )
    const blends = new Set(
      Object.values(BLENDS).map(([a, p, b]) => blend(TOKYO_NIGHT[a], TOKYO_NIGHT[b], p / 100)),
    )
    const foreign = [...hexes, ...rgbs].filter((c) => !palette.has(c) && !blends.has(c))
    expect([...foreign, ...(code.match(/\b(white|black)\b/g) ?? [])]).toEqual([])
  })
})
