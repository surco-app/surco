import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('.', import.meta.url))
const sources = (readdirSync(root, { recursive: true }) as string[])
  .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
  .map((f) => f.split('\\').join('/'))

function offenders(pattern: RegExp, allowed: (match: string) => boolean): string[] {
  return sources.flatMap((file) =>
    [...readFileSync(join(root, file), 'utf8').matchAll(pattern)]
      .map((m) => m[0])
      .filter((m) => !allowed(m))
      .map((m) => `${file}: ${m}`),
  )
}

describe('a disabled control looks the same on every screen, so «not yet» reads at a glance', () => {
  it('dims every disabled control to 40%', () => {
    expect(offenders(/disabled:opacity-\d+/g, (m) => m === 'disabled:opacity-40')).toEqual([])
  })
})

const TEXT_SIZE =
  /(?<![\w-])text-(xs|sm|base|lg|[2-9]?xl|label|section|figure|\[\d+(?:\.\d+)?px\])(?![\w-])/g
const TYPE_SCALE = new Set([
  'text-label',
  'text-xs',
  'text-section',
  'text-sm',
  'text-base',
  'text-xl',
  'text-figure',
])
const OVER_THE_WAVE = new Set(['components/CueWave.tsx', 'components/SpectrumGlimpse.tsx'])

describe('type comes in six sizes plus the big figure, each with one job, so hierarchy reads the same everywhere', () => {
  it('sizes every text from the scale', () => {
    expect(
      sources.flatMap((file) =>
        [...readFileSync(join(root, file), 'utf8').matchAll(TEXT_SIZE)]
          .map((m) => m[0])
          .filter((m) => !TYPE_SCALE.has(m) && !(m === 'text-[10px]' && OVER_THE_WAVE.has(file)))
          .map((m) => `${file}: ${m}`),
      ),
    ).toEqual([])
  })

  it('emphasises with semibold at most', () => {
    expect(offenders(/(?<![\w-])font-bold(?![\w-])/g, () => false)).toEqual([])
  })
})

const DURATIONS = new Set(['duration-120', 'duration-200', 'duration-240'])
const SEARCH_HIT_FADE = 'components/SettingsModal.tsx: duration-500'
const NOT_A_RESPONSE = [
  'spectrum-scan',
  'skeleton-sweep',
  'progress-sweep',
  'vinyl-spin',
  'donate-pop-in',
  'blocked-shake',
  'top-progress',
  'star-punch',
  'empty-disc-ping',
  'empty-disc-in',
  'empty-copy-in',
  'toast-countdown',
  'result-new',
  'allow-discrete',
  '--progress',
  'marquee-dist',
]

describe('everything that answers the user moves on one curve and three durations, so the app feels of a piece', () => {
  it('times every transition in the components from the three durations', () => {
    expect(
      offenders(/(?<![\w-])duration-(?:\d+|\[[^\]]+\])/g, (m) => DURATIONS.has(m)).filter(
        (m) => m !== SEARCH_HIT_FADE,
      ),
    ).toEqual([])
  })

  it('eases every transition in the components with the standard curve', () => {
    expect(
      offenders(/(?<![\w-])ease-(?:out|in-out|in|linear|\[[^\]]+\])(?![\w-])/g, () => false),
    ).toEqual([])
  })

  it('times and eases every responsive animation in the stylesheet from the tokens', () => {
    const css = readFileSync(join(root, 'index.css'), 'utf8')
    const literal = css
      .split('\n')
      .filter(
        (line) =>
          /^\s*(transition|animation)(-duration)?\s*:/.test(line) ||
          /^\s+[a-z-]+\s+[\d.]+m?s/.test(line),
      )
      .filter((line) =>
        /\d(?:\.\d+)?m?s\b|cubic-bezier|\bease\b/.test(line.replace(/var\([^)]*\)/g, '')),
      )
      .filter((line) => !NOT_A_RESPONSE.some((name) => line.includes(name)))
    expect(literal).toEqual([])
  })
})

describe('every window has the same 16 px corners, so a dialog reads as a window wherever it opens', () => {
  it('rounds every ModalShell panel with rounded-2xl', () => {
    const corners = sources.flatMap((file) =>
      [...readFileSync(join(root, file), 'utf8').matchAll(/<ModalShell\b[\s\S]*?>/g)].flatMap((m) =>
        [...m[0].matchAll(/(?<![\w-])rounded(?:-[a-z0-9]+)?(?![\w-])/g)]
          .map((r) => r[0])
          .filter((r) => r !== 'rounded-2xl')
          .map((r) => `${file}: ${r}`),
      ),
    )
    expect(corners).toEqual([])
  })
})

function openingTags(code: string, marker: string): string[] {
  const tags: string[] = []
  for (let at = code.indexOf(marker); at !== -1; at = code.indexOf(marker, at + 1)) {
    const open = code.lastIndexOf('<', at)
    let depth = 0
    let end = open
    for (; end < code.length; end++) {
      const ch = code[end]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '>' && depth === 0) break
    }
    tags.push(code.slice(open, end + 1))
  }
  return tags
}

describe('a menu row is highlighted with corners parallel to its menu, so the two curves nest', () => {
  it('rounds every menu item with 4 px inside the 8 px menu and its 4 px inset', () => {
    const items = sources.flatMap((file) =>
      openingTags(readFileSync(join(root, file), 'utf8'), 'role="menuitem').flatMap((tag) =>
        [...tag.matchAll(/(?<![\w:-])rounded(?:-[a-z0-9]+)?(?![\w-])/g)]
          .map((r) => r[0])
          .filter((r) => r !== 'rounded')
          .map((r) => `${file}: ${r}`),
      ),
    )
    expect(items).toEqual([])
  })
})
