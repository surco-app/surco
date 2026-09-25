import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

// The same rule for the components and the HTML shell: an inline style, an SVG or a
// Tailwind class paints a Tokyo Night colour. Tailwind's white, black and default palette
// are in none of them. Shadows are exempt for now: whether the site keeps them at all is a
// pending flat-design decision, so their colour waits for it.
describe('components paint only Tokyo Night colours', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const sources = (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => [f, join(root, f)])
  sources.push(['index.html', fileURLToPath(new URL('../../index.html', import.meta.url))])

  for (const [name, path] of sources) {
    const code = readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, '')
    it(`${name} uses only palette colours`, () => {
      const hexes = [...code.matchAll(/['"`(\s]#([0-9a-fA-F]{6})\b/g)].map((m) => `#${m[1]}`)
      const rgbs = [...code.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)].map((m) =>
        hex(m[1], m[2], m[3]),
      )
      const foreign = [...hexes, ...rgbs].filter((c) => !palette.has(c.toLowerCase()))
      const tailwind = (
        code.match(
          /\b[a-z]+-(white|black|(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b(\/\d+)?/g,
        ) ?? []
      ).filter((c) => !c.startsWith('shadow-'))
      expect([...foreign, ...tailwind]).toEqual([])
    })
  }

  // canvas-confetti draws in its own neon rainbow unless it is handed colours, and no
  // literal in the source would show it.
  it('hands the donation confetti the palette instead of the library defaults', () => {
    const code = readFileSync(join(root, 'components/DonateCompleted.tsx'), 'utf8')
    const calls = [...code.matchAll(/confetti\(\{[^}]*\}[^)]*\)/g)].map((m) => m[0])
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) expect(call).toMatch(/colors[:,]/)
  })
})
