// The visitor's OS, and the release asset that OS installs. Lives here rather than in
// DownloadButton so it can be tested: the web suite is node-environment and only picks
// up src/**/*.test.ts, so nothing that stays inside a .tsx component is reachable.

export type OS = 'mac' | 'windows' | 'linux' | 'other'

// Order matters. Android's UA embeds "Linux" ("Linux; Android 14") and iOS reports
// "like Mac OS X", so the mobile platforms have to be ruled out BEFORE the desktop
// tests they would otherwise match — a phone offered an x86_64 AppImage (or a .dmg)
// downloads a file it cannot run. Neither has a Surco build, so both land on 'other',
// which shows the generic "view downloads" link instead of a broken install.
export function detectOS(): OS {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return 'other'
  if (/Windows/i.test(ua)) return 'windows'
  if (/Mac/i.test(ua)) return 'mac'
  if (/Linux|X11/i.test(ua)) return 'linux'
  return 'other'
}

// What the OS's primary installer asset ends with, for matching against a release's
// asset names. macOS resolves to arm64 because the browser cannot distinguish Apple
// Silicon from Intel (Safari calls both "Intel Mac"); the Intel .dmg gets its own link.
// Linux is x86_64, not x64 — electron-builder renames the arch for AppImage.
const SUFFIX: Record<Exclude<OS, 'other'>, string> = {
  mac: 'arm64.dmg',
  windows: '.exe',
  linux: '.AppImage',
}

export function installerSuffix(os: Exclude<OS, 'other'>): string {
  return SUFFIX[os]
}
