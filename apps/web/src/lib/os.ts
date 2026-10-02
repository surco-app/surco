// The visitor's OS, and the release asset that OS installs. Lives here rather than in
// DownloadButton so it can be tested: the web suite is node-environment and only picks
// up src/**/*.test.ts, so nothing that stays inside a .tsx component is reachable.

// 'other' is a real platform with no Surco build (a phone); 'unknown' is detection that
// hasn't run yet — the prerender, where there is no browser window. They must render
// differently: shipping the 'other' fallback link in the static HTML made it the CTA
// every visitor saw before hydration, pointing at a raw GitHub asset list.
export type OS = 'mac' | 'windows' | 'linux' | 'other' | 'unknown'

// Order matters. Android's UA embeds "Linux" ("Linux; Android 14") and iOS reports
// "like Mac OS X", so the mobile platforms have to be ruled out BEFORE the desktop
// tests they would otherwise match — a phone offered an x86_64 AppImage (or a .dmg)
// downloads a file it cannot run. Neither has a Surco build, so both land on 'other',
// which shows the generic "view downloads" link instead of a broken install.
export function detectOS(): OS {
  // Node 21 and later define `navigator` as a real global with a userAgent of their own
  // ("Node.js/26"), so neither tells a prerender from a browser; the missing window does.
  if (typeof window === 'undefined') return 'unknown'
  const ua = typeof navigator === 'undefined' ? undefined : navigator?.userAgent
  if (!ua) return 'unknown'
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return 'other'
  if (/Windows/i.test(ua)) return 'windows'
  if (/Mac/i.test(ua)) return 'mac'
  if (/Linux|X11/i.test(ua)) return 'linux'
  return 'other'
}

// What the OS's primary installer asset ends with, for matching against a release's
// asset names. macOS resolves to arm64 because most browsers cannot distinguish Apple
// Silicon from Intel (Safari calls both "Intel Mac"); see macInstallers for the Mac that can.
// Linux is x86_64, not x64 — electron-builder renames the arch for AppImage.
const SUFFIX: Record<Exclude<OS, 'other' | 'unknown'>, string> = {
  mac: 'arm64.dmg',
  windows: '.exe',
  linux: '.AppImage',
}

export function installerSuffix(os: Exclude<OS, 'other' | 'unknown'>): string {
  return SUFFIX[os]
}

export type MacArch = 'arm64' | 'x64'

// Every Mac browser reports "Intel Mac OS X" in its user agent, so the CPU only shows
// through Chromium's client hints (Chrome, Brave, Edge). Safari and Firefox have none, and
// a browser may refuse the request; both stay unknown rather than guessing.
export async function detectMacArch(): Promise<MacArch | undefined> {
  const data = (
    navigator as {
      userAgentData?: {
        getHighEntropyValues: (hints: string[]) => Promise<{ architecture?: string }>
      }
    }
  ).userAgentData
  if (!data) return undefined
  try {
    const { architecture } = await data.getHighEntropyValues(['architecture'])
    if (architecture === 'x86') return 'x64'
    if (architecture === 'arm') return 'arm64'
    return undefined
  } catch {
    return undefined
  }
}

export function macInstallers(arch: MacArch | undefined): { primary: string; secondary: string } {
  return arch === 'x64'
    ? { primary: 'x64.dmg', secondary: 'arm64.dmg' }
    : { primary: 'arm64.dmg', secondary: 'x64.dmg' }
}
