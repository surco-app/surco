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
