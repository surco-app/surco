import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FAINT = 'border-[var(--color-line)]'

function faintBoxedFields(code: string): number[] {
  const lines: number[] = []
  for (const m of code.matchAll(/<(input|textarea)\s/g)) {
    const at = m.index ?? 0
    const tag = code.slice(at, code.indexOf('/>', at))
    if (/type="(checkbox|radio|range|file|hidden)"/.test(tag)) continue
    if (tag.includes('rounded') && tag.includes(FAINT))
      lines.push(code.slice(0, at).split('\n').length)
  }
  return lines
}

const FIELD_SHELLS: Record<string, string> = {
  'components/PathField.tsx': `rounded-lg border ${FAINT} bg-[var(--color-field)]`,
  'components/FindReplaceModal.tsx': `${FAINT} focus-within:border-[var(--color-accent)]`,
}

describe('a text field shows its edge at 3:1, so an empty one is not read as plain background', () => {
  const root = fileURLToPath(new URL('.', import.meta.url))
  const sources = (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
    .map((f) => f.split('\\').join('/'))

  for (const file of sources) {
    it(`${file} draws no boxed field with the faint separator line`, () => {
      expect(faintBoxedFields(readFileSync(join(root, file), 'utf8'))).toEqual([])
    })
  }

  for (const [file, shell] of Object.entries(FIELD_SHELLS)) {
    it(`${file} draws its field shell with the control border`, () => {
      expect(readFileSync(join(root, file), 'utf8')).not.toContain(shell)
    })
  }
})
