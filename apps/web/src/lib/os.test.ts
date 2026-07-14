import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectOS, installerSuffix } from './os'

describe('detectOS', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const withUA = (userAgent: string) => vi.stubGlobal('navigator', { userAgent })

  it('reads Windows', () => {
    withUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
    expect(detectOS()).toBe('windows')
  })

  it('reads macOS', () => {
    withUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
    expect(detectOS()).toBe('mac')
  })

  it('reads Linux from the X11 desktop UA', () => {
    withUA('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36')
    expect(detectOS()).toBe('linux')
  })

  // Android's UA embeds "Linux" ("Linux; Android 14"), so a bare /Linux/ test would
  // offer an x86_64 desktop AppImage to every Android phone — a download that cannot
  // run. Android has no Surco build, so it must fall through to the generic link.
  it('does not mistake Android for desktop Linux', () => {
    withUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile')
    expect(detectOS()).toBe('other')
  })

  // Same trap on the Apple side: an iPhone reports "like Mac OS X", and iPads that
  // request the desktop site report a plain "Macintosh" UA. Neither runs a .dmg.
  it('does not mistake an iPhone for a Mac', () => {
    withUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')
    expect(detectOS()).toBe('other')
  })

  // The site is statically prerendered in Node, where there is no navigator. The
  // prerendered HTML must be the OS-agnostic variant, not a guess.
  it('falls back to other when there is no navigator', () => {
    vi.stubGlobal('navigator', undefined)
    expect(detectOS()).toBe('other')
  })
})

describe('installerSuffix', () => {
  // The suffix each OS's primary download ends with. Linux is x86_64, not x64:
  // electron-builder renames the arch for AppImage (see getArtifactArchName in
  // builder-util), so matching on 'x64.AppImage' would find nothing.
  it('maps each OS to the asset its release carries', () => {
    expect(installerSuffix('mac')).toBe('arm64.dmg')
    expect(installerSuffix('windows')).toBe('.exe')
    expect(installerSuffix('linux')).toBe('.AppImage')
  })
})
