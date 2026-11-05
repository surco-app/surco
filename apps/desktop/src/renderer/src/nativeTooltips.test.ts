import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const STILL_NATIVE = new Set<string>([
  'components/OnboardingWizard.tsx',
  'components/PathField.tsx',
  'components/settings/StatsTab.tsx',
])

function nativeTitles(code: string): number[] {
  const lines: number[] = []
  for (const m of code.matchAll(/\stitle=[{"]/g)) {
    const at = m.index ?? 0
    const open = code.lastIndexOf('<', at)
    const tag = /^<([A-Za-z][\w.]*)/.exec(code.slice(open))
    if (tag && /^[a-z]/.test(tag[1])) lines.push(code.slice(0, at).split('\n').length)
  }
  return lines
}

describe('every hint is Surco’s own tooltip, never the native one', () => {
  const root = fileURLToPath(new URL('.', import.meta.url))
  const sources = (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
    .map((f) => f.split('\\').join('/'))

  for (const file of sources) {
    it(`${file} puts no title on an element`, () => {
      const lines = nativeTitles(readFileSync(join(root, file), 'utf8'))
      if (STILL_NATIVE.has(file)) expect(lines).not.toEqual([])
      else expect(lines).toEqual([])
    })
  }
})
