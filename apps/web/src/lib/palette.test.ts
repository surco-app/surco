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

// The scenes draw the desktop app, so every colour inside them is Tokyo Night, as the app
// ships it: a colour of the palette, or a blend of two of them (Vicent 25/09). The page around
// them follows Vicent's other sites, Cuts and Nada: white in light, near black in dark, and
// their grays for text, lines and surfaces, with Surco's blue as the one accent.
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
  'color-faint': ['dark5', 60, 'fg_dark'],
}

const palette = new Set<string>(Object.values(TOKYO_NIGHT))

// The light theme is the desktop app's: its [data-theme='light'] palette, plus Tokyo Night
// Light's teal and magenta, which the app never needed and the site's accents do. The deep
// bands take a ground halfway between the app's ink and panel, as quiet as the dark ones.
const SURCO_LIGHT = {
  ink: '#d6d8df',
  panel: '#e6e7ed',
  panel_2: '#f0f1f5',
  field: '#f4f5f8',
  line: '#c2c5cf',
  input_border: '#707280',
  accent: '#2959aa',
  fg: '#343b58',
  fg_muted: '#40434f',
  fg_dim: '#565a69',
  fg_faint: '#61646f',
  good: '#33635c',
  warn: '#785526',
  danger: '#8c4351',
  teal: '#166775',
  ink_panel_mix: '#dee0e6',
  magenta: '#5a4a78',
} as const

const lightPalette = new Set<string>(Object.values(SURCO_LIGHT))

const FAMILY = {
  white: '#ffffff',
  gray_50: '#f9fafb',
  gray_100: '#f3f4f6',
  gray_200: '#e5e7eb',
  gray_300: '#d1d5dc',
  gray_400: '#99a1af',
  gray_500: '#6a7282',
  gray_600: '#4a5565',
  gray_700: '#364153',
  gray_800: '#1e2939',
  gray_900: '#101828',
  gray_950: '#030712',
  neutral_800: '#262626',
  neutral_900: '#171717',
  neutral_950: '#0a0a0a',
} as const

const familyPalette = new Set<string>(Object.values(FAMILY))

const ACCENTS = [
  'color-blue',
  'color-cyan',
  'color-purple',
  'color-green',
  'color-red',
  'color-amber',
]

const REKORDBOX_CUE_COLOURS_BY_FILE: Record<string, string[]> = {
  'lib/scenes.ts': ['#e62828', '#28e214', '#305aff'],
}

const block = (selector: string) => {
  const start = css.indexOf(selector)
  return css.slice(start, css.indexOf('\n}', start))
}
const tokens = (from: string) =>
  new Map([...from.matchAll(/--(color-[\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]))
const pageDark = tokens(block('@theme'))
const pageLight = tokens(block(':root[data-theme="light"] {'))
const appDark = tokens(block('.app-palette {'))
const appLight = tokens(block(':root[data-theme="light"] .app-palette {'))

describe('Tokyo Night palette', () => {
  for (const [token, value] of appDark) {
    it(`${token} in the scenes is a Tokyo Night colour or a blend of two`, () => {
      const mix = BLENDS[token]
      if (mix)
        expect(value.toLowerCase()).toBe(
          blend(TOKYO_NIGHT[mix[0]], TOKYO_NIGHT[mix[2]], mix[1] / 100),
        )
      else expect(palette).toContain(value.toLowerCase())
    })
  }

  for (const token of pageDark.keys()) {
    it(`gives the scenes their own ${token}, so the app they draw keeps its theme on the page`, () => {
      expect(appDark.has(token)).toBe(true)
      expect(appLight.has(token)).toBe(true)
    })
  }

  for (const [token, value] of appLight) {
    it(`${token} in the light scenes is a colour of Surco's light palette`, () => {
      expect(lightPalette).toContain(value.toLowerCase())
    })
  }

  it('wraps every scene in the app palette, through the replay frame they all sit in', () => {
    const replay = readFileSync(
      fileURLToPath(new URL('../components/scenes/Replay.tsx', import.meta.url)),
      'utf8',
    )
    expect(replay).toMatch(/className="app-palette[^"]*">\s*<Fragment key=\{run\}>\{children\}/)
  })
})

describe('family palette', () => {
  for (const [theme, page] of [
    ['dark', pageDark],
    ['light', pageLight],
  ] as const) {
    for (const [token, value] of page) {
      if (ACCENTS.includes(token) || token === 'color-spectrum') continue
      it(`${token} on the ${theme} page is one of Cuts and Nada's grays`, () => {
        expect(familyPalette).toContain(value.toLowerCase())
      })
    }
  }

  it('grounds the light page in white, like Cuts and Nada', () => {
    expect(pageLight.get('color-bg')?.toLowerCase()).toBe(FAMILY.white)
  })

  it('grounds the dark page in the near black Cuts uses', () => {
    expect(pageDark.get('color-bg')?.toLowerCase()).toBe(FAMILY.neutral_950)
  })

  it('keeps Surco blue as the accent in both themes', () => {
    expect(pageDark.get('color-blue')?.toLowerCase()).toBe(TOKYO_NIGHT.blue)
    expect(pageLight.get('color-blue')?.toLowerCase()).toBe(SURCO_LIGHT.accent)
  })
})

describe('index.css', () => {
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
    const foreign = [...hexes, ...rgbs].filter(
      (c) => !palette.has(c) && !lightPalette.has(c) && !familyPalette.has(c) && !blends.has(c),
    )
    expect([...foreign, ...(code.match(/\b(white|black)\b/g) ?? [])]).toEqual([])
  })
})

// The same rule for the components and the HTML shell: an inline style, an SVG or a
// Tailwind class paints a palette colour. Tailwind's white, black and default palette
// are in none of them. Shadows are exempt for now: whether the site keeps them at all is a
// pending flat-design decision, so their colour waits for it.
describe('light theme', () => {
  const start = css.indexOf('[data-theme="light"]')

  it('is declared on the root, where the theme script sets it', () => {
    expect(start).toBeGreaterThan(-1)
  })

  for (const token of pageDark.keys()) {
    it(`flips ${token}, or the dark ink would stay on the light page`, () => {
      expect(pageLight.has(token)).toBe(true)
    })
  }

  for (const [token, value] of pageLight) {
    it(`${token} is a colour of the family's or Surco's light palette`, () => {
      expect([...lightPalette, ...familyPalette]).toContain(value.toLowerCase())
    })
  }
})

describe('components paint only palette colours', () => {
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
      const rekordbox = REKORDBOX_CUE_COLOURS_BY_FILE[name] ?? []
      const foreign = [...hexes, ...rgbs].filter(
        (c) =>
          !palette.has(c.toLowerCase()) &&
          !lightPalette.has(c.toLowerCase()) &&
          !familyPalette.has(c.toLowerCase()) &&
          !rekordbox.includes(c.toLowerCase()),
      )
      const tailwind = (
        code.match(
          /\b[a-z]+-(white|black|(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b(\/\d+)?/g,
        ) ?? []
      ).filter((c) => !c.startsWith('shadow-'))
      expect([...foreign, ...tailwind]).toEqual([])
    })
  }

  // A literal paints the same in both themes, so it stays dark-palette ink on the light page.
  // Only the theme tokens flip; rekordbox's cue colours are the hardware's, not the theme's.
  for (const [name, path] of sources.filter(([name]) => name !== 'index.html')) {
    const code = readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, '')
    it(`${name} names its colours through the theme tokens`, () => {
      const rekordbox = REKORDBOX_CUE_COLOURS_BY_FILE[name] ?? []
      const hexes = [...code.matchAll(/['"`(\s[]#([0-9a-fA-F]{6})\b/g)]
        .map((m) => `#${m[1]}`.toLowerCase())
        .filter((c) => !rekordbox.includes(c))
      const rgbs = code.match(/rgba?\([^)]*\)/g) ?? []
      expect([...hexes, ...rgbs]).toEqual([])
    })
  }

  // A shadow in Tailwind's black is as heavy on the light page as on the dark one; the
  // shade token lightens with the theme.
  for (const [name, path] of sources.filter(([name]) => name !== 'index.html')) {
    it(`${name} casts its shadows in the theme's shade`, () => {
      expect(readFileSync(path, 'utf8').match(/shadow-black\b/g) ?? []).toEqual([])
    })
  }

  // macOS draws the window buttons in the same red, amber and green in both appearances;
  // the status tokens darken in light, which turned them into maroon and olive dots.
  it("keeps the scene windows' traffic lights in their dark-theme colours", () => {
    const chrome = readFileSync(join(root, 'components/scenes/AppChrome.tsx'), 'utf8')
    expect(chrome).toMatch(/className="keep-dark[^"]*">\s*<i[^>]*bg-red[^>]*\/>\s*<i[^>]*bg-amber/)
    const keepDark = css.slice(
      css.indexOf('.keep-dark {'),
      css.indexOf('}', css.indexOf('.keep-dark {')),
    )
    for (const token of ['red', 'amber', 'green']) expect(keepDark).toContain(`--color-${token}:`)
  })

  // canvas-confetti draws in its own neon rainbow unless it is handed colours, and no
  // literal in the source would show it.
  it('hands the donation confetti the palette instead of the library defaults', () => {
    const code = readFileSync(join(root, 'components/DonateCompleted.tsx'), 'utf8')
    const calls = [...code.matchAll(/confetti\(\{[^}]*\}[^)]*\)/g)].map((m) => m[0])
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) expect(call).toMatch(/colors[:,]/)
  })
})
