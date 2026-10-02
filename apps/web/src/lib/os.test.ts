import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectMacArch, detectOS, installerSuffix, macInstallers, montereyUrl } from './os'

describe('detectOS', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const withUA = (userAgent: string) => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', { userAgent })
  }

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

  // The site is statically prerendered in Node, where there is no navigator — but that
  // is "not known yet", not "no build for this platform". Collapsing the two made the
  // prerendered HTML ship the generic "view downloads" link as the primary CTA, so a
  // visitor whose JS was slow, blocked, or whose GitHub fetch 403'd was sent to a raw
  // asset list (.blockmap, latest.yml) instead of an installer.
  it('reports unknown when there is no navigator', () => {
    vi.stubGlobal('navigator', undefined)
    expect(detectOS()).toBe('unknown')
  })

  // Node 21 and later define navigator as a real global with a userAgent of their own
  // ("Node.js/26"), so a check on navigator alone sent the prerender down to 'other' and the
  // static HTML shipped the generic "view downloads" link again. No window is what marks
  // the prerender.
  it('reports unknown in the prerender even though Node defines a navigator', () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('navigator', { userAgent: 'Node.js/26' })
    expect(detectOS()).toBe('unknown')
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

describe('detectMacArch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const withHints = (getHighEntropyValues?: () => Promise<{ architecture?: string }>) => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      ...(getHighEntropyValues ? { userAgentData: { getHighEntropyValues } } : {}),
    })
  }

  // Every Mac browser says "Intel Mac OS X", so an Intel owner was handed the arm64 build
  // by the big button and got "not supported on this Mac". Chromium's client hints are the
  // one place the real CPU shows through.
  it('reads an Intel Mac from the client hints', async () => {
    withHints(async () => ({ architecture: 'x86' }))
    expect(await detectMacArch()).toBe('x64')
  })

  it('reads an Apple Silicon Mac from the client hints', async () => {
    withHints(async () => ({ architecture: 'arm' }))
    expect(await detectMacArch()).toBe('arm64')
  })

  // Safari and Firefox expose no client hints. Guessing there would be a coin toss, so the
  // answer is "unknown" and the page keeps offering both builds.
  it('reports unknown when the browser has no client hints', async () => {
    withHints()
    expect(await detectMacArch()).toBeUndefined()
  })

  it('reports unknown when the browser refuses the hints', async () => {
    withHints(async () => {
      throw new Error('NotAllowedError')
    })
    expect(await detectMacArch()).toBeUndefined()
  })

  it('reports unknown for an architecture with no Mac build', async () => {
    withHints(async () => ({ architecture: '' }))
    expect(await detectMacArch()).toBeUndefined()
  })
})

describe('macInstallers', () => {
  // The big button carries the build that runs on this Mac and the small link the other
  // one, so a wrong guess is still one click from the right file.
  it('leads with the Intel build on a Mac known to be Intel', () => {
    expect(macInstallers('x64')).toEqual({ primary: 'x64.dmg', secondary: 'arm64.dmg' })
  })

  it('leads with Apple Silicon when the Mac is Apple Silicon or unknown', () => {
    expect(macInstallers('arm64')).toEqual({ primary: 'arm64.dmg', secondary: 'x64.dmg' })
    expect(macInstallers(undefined)).toEqual({ primary: 'arm64.dmg', secondary: 'x64.dmg' })
  })
})

describe('montereyUrl', () => {
  // From 1.3.0 Surco runs on Electron 44, which needs macOS 13. 1.2.3 is the last build
  // that opens on macOS 12, so with a known CPU the link is that exact installer.
  it('points at the last build that runs on macOS 12', () => {
    expect(montereyUrl('x64')).toBe(
      'https://github.com/surco-app/surco-releases/releases/download/v1.2.3/Surco-1.2.3-x64.dmg',
    )
    expect(montereyUrl('arm64')).toBe(
      'https://github.com/surco-app/surco-releases/releases/download/v1.2.3/Surco-1.2.3-arm64.dmg',
    )
  })

  // Safari can't tell the CPU, and a Monterey Mac is as likely Intel as Apple Silicon.
  // Guessing one installer would hand half of them a build that won't open, so the link
  // opens the release, where both are listed.
  it('opens the release with both builds when the CPU is unknown', () => {
    expect(montereyUrl(undefined)).toBe(
      'https://github.com/surco-app/surco-releases/releases/tag/v1.2.3',
    )
  })
})
