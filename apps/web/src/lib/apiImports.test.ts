import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const API_DIR = join(import.meta.dirname, '../../api')

describe('Vercel functions', () => {
  it('import local modules with a .js extension, because Node runs them as ES modules and cannot resolve a bare path', () => {
    const bare = readdirSync(API_DIR)
      .filter((file) => file.endsWith('.ts'))
      .flatMap((file) =>
        [...readFileSync(join(API_DIR, file), 'utf8').matchAll(/from '(\.{1,2}\/[^']+)'/g)]
          .map((m) => m[1])
          .filter((path) => !path.endsWith('.js'))
          .map((path) => `${file}: ${path}`),
      )
    expect(bare).toEqual([])
  })
})
