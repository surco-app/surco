import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('preloadLazyWhenIdle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.resetModules()
  })

  it('loads every lazy chunk once, in the first idle moment, so the first open of a screen or modal does not wait for its chunk nor compete with the startup reads', async () => {
    const idle = vi.fn<(cb: () => void) => number>(() => 1)
    vi.stubGlobal('requestIdleCallback', idle)
    const { lazyChunk, preloadLazyWhenIdle } = await import('./lazyChunk')
    const load = vi.fn(async () => ({ default: () => null }))
    lazyChunk(load)
    preloadLazyWhenIdle()
    preloadLazyWhenIdle()
    expect(idle).toHaveBeenCalledTimes(1)
    expect(load).not.toHaveBeenCalled()
    idle.mock.calls[0][0]()
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1))
  })

  it('falls back to a timer where there is no idle callback', async () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    vi.useFakeTimers()
    const { lazyChunk, preloadLazyWhenIdle } = await import('./lazyChunk')
    const load = vi.fn(async () => ({ default: () => null }))
    lazyChunk(load)
    preloadLazyWhenIdle()
    expect(load).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(load).toHaveBeenCalledTimes(1)
  })
})
