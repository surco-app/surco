import { afterEach, describe, expect, it, vi } from 'vitest'
import { isMacOS, isWindows } from './platform'

function setPlatform(platform: string): void {
  vi.stubGlobal('window', { api: { platform } })
}

afterEach(() => vi.unstubAllGlobals())

// The whole UI gates macOS-only features (Apple Music, Reveal in Finder) on this, so the
// check has to be exactly 'darwin' and nothing else — a loose match would offer those
// integrations on platforms that can't honour them.
describe('isMacOS', () => {
  it('is true only on darwin', () => {
    setPlatform('darwin')
    expect(isMacOS()).toBe(true)
  })

  it('is false on every other platform', () => {
    setPlatform('win32')
    expect(isMacOS()).toBe(false)
    setPlatform('linux')
    expect(isMacOS()).toBe(false)
  })
})

describe('isWindows', () => {
  it('is true only on win32', () => {
    setPlatform('win32')
    expect(isWindows()).toBe(true)
  })

  it('is false on every other platform', () => {
    setPlatform('darwin')
    expect(isWindows()).toBe(false)
  })
})
