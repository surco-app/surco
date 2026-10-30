import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { btnPrimary } from './ui'

const root = fileURLToPath(new URL('..', import.meta.url))
const css = readFileSync(join(root, 'index.css'), 'utf8')
const sources = (readdirSync(root, { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => [f, readFileSync(join(root, f), 'utf8')] as const)

// The site draws the desktop app, and the app is flat: its one shadow is for what floats
// over the content. Here that is the language menu, the popover in the replace scene and
// the file being dragged into the drop scene. A ring or a glow with no offset is not depth.
const FLOATING: Record<string, number> = {
  'components/Header.tsx': 1,
  'components/scenes/ReplaceScene.tsx': 1,
  'components/scenes/DropScene.tsx': 1,
}

describe('flat, like the app', () => {
  for (const [name, code] of sources) {
    it(`${name} casts a shadow only under what floats`, () => {
      const depth = code.match(/\bshadow-(sm|md|lg|xl|2xl)\b|shadow-\[(?!inset_)(?!0_0_)/g) ?? []
      expect(depth.length).toBe(FLOATING[name] ?? 0)
    })
  }

  it('draws no edge highlight, grain or corner halo on the page', () => {
    const decoration = sources.flatMap(([name, code]) =>
      (
        code.match(/inset-shadow-edge|\bgrain\b|radial-gradient\(55%|\bblur-(xl|2xl|3xl)\b/g) ?? []
      ).map((m) => `${name}: ${m}`),
    )
    expect(decoration).toEqual([])
    expect(css).not.toMatch(/\.grain\b|--inset-shadow-edge/)
  })

  it('keeps the primary button a flat brand fill, without a gradient, a glow or a lift', () => {
    expect(btnPrimary).toMatch(/\bbg-blue\b/)
    expect(btnPrimary).not.toMatch(/gradient|from-|to-cyan/)
    expect(btnPrimary).not.toMatch(/shadow-|-translate-y/)
  })
})
