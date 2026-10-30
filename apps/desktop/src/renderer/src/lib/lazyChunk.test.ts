import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { lazyChunk, preloadLazy } from './lazyChunk'

const SOURCE = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

describe('lazyChunk', () => {
  it('declares every lazy component of the app, so preloading in tests can never miss one and bring back a wait that races its chunk', () => {
    const direct = sourceFiles(SOURCE).filter(
      (path) =>
        !path.endsWith(join('lib', 'lazyChunk.ts')) &&
        /import\s*\{[^}]*\blazy\b[^}]*\}\s*from\s*'react'|React\.lazy\(/.test(
          readFileSync(path, 'utf8'),
        ),
    )
    expect(direct).toEqual([])
  })

  it('preloads every chunk declared with it, including one a preloaded chunk declares', async () => {
    const Inner = () => null
    const inner = vi.fn(async () => ({ default: Inner }))
    const outer = vi.fn(async () => {
      lazyChunk(inner)
      return { default: Inner }
    })
    lazyChunk(outer)
    await preloadLazy()
    expect(outer).toHaveBeenCalledTimes(1)
    expect(inner).toHaveBeenCalledTimes(1)
  })
})
