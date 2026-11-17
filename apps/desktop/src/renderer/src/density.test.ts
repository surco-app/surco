import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { listRowClass } from './components/ListRow'

const root = fileURLToPath(new URL('.', import.meta.url))
const sources = (readdirSync(root, { recursive: true }) as string[])
  .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
  .map((f) => f.split('\\').join('/'))
const css = readFileSync(join(root, 'index.css'), 'utf8')

describe('Compact reaches the editor, where a library track is three screens of scroll', () => {
  it('moves a label beside its input from 19rem in Compact, so the narrow editor of a library stops stacking every field on two lines', () => {
    const variant = css.slice(css.indexOf('@custom-variant beside'), css.indexOf('/* Tokyo Night'))
    expect(variant).toMatch(/@container \(min-width: 24rem\) \{\s*@slot;/)
    expect(variant).toMatch(
      /@container \(min-width: 19rem\) \{\s*&:where\(\[data-density="compact"\] \*\) \{\s*@slot;/,
    )
  })

  it('leaves no form class on the fixed 24rem switch, which Compact could not move', () => {
    expect(
      sources.filter((file) => readFileSync(join(root, file), 'utf8').includes('@[24rem]:')),
    ).toEqual([])
  })

  it('gives every editor section the same shorter gap, so no section keeps the Normal rhythm among compact ones', () => {
    const loose = sources.filter((file) => {
      if (!file.startsWith('components/') || /MusicReview|DamageDetail|settings\//.test(file)) return false
      return /mt-6 border-t border-\[var\(--color-line\)\] pt-[56](?! compact:mt-3 compact:pt-3)/.test(
        readFileSync(join(root, file), 'utf8'),
      )
    })
    expect(loose).toEqual([])
  })
})

describe('a list without waves is the densest list Surco has', () => {
  it('halves the row padding again in Compact, since two lines of text need no room for a wave', () => {
    expect(listRowClass(false, false, true)).toContain('compact:py-0.5')
    expect(listRowClass(false, false, true)).not.toContain('compact:py-1 ')
  })

  it('keeps the padding of a row with waves, whose third line already fills it', () => {
    expect(listRowClass(false, false)).toContain('compact:py-1 ')
  })
})
