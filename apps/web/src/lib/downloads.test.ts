import { describe, expect, it } from 'vitest'
import { countDownloads, pickInstallerRelease } from './downloads'

describe('countDownloads', () => {
  // Only installers count. The release also carries .zip/.blockmap/.yml assets
  // that electron-updater fetches on every auto-update; counting those would
  // turn update traffic into phantom downloads.
  it('counts only .dmg and .exe assets, ignoring update artifacts', () => {
    const releases = [
      {
        assets: [
          { name: 'Surco-0.1.2-arm64.dmg', download_count: 120 },
          { name: 'Surco-0.1.2-x64.dmg', download_count: 18 },
          { name: 'Surco-0.1.2-Setup.exe', download_count: 40 },
          { name: 'Surco-0.1.2-arm64.zip', download_count: 999 },
          { name: 'latest-mac.yml', download_count: 5000 },
        ],
      },
    ]
    expect(countDownloads(releases)).toBe(178)
  })

  it('sums across every release', () => {
    const releases = [
      { assets: [{ name: 'a-arm64.dmg', download_count: 60 }] },
      { assets: [{ name: 'b-Setup.exe', download_count: 5 }] },
    ]
    expect(countDownloads(releases)).toBe(65)
  })

  it('is zero before any release is published', () => {
    expect(countDownloads([])).toBe(0)
  })
})

describe('pickInstallerRelease', () => {
  // The reported bug: while a new release is building, its installer isn't uploaded yet, so
  // the button must fall back to the previous build instead of showing "unavailable".
  it('skips a release whose installer is not uploaded yet and uses the previous one', () => {
    const releases = [
      { tag_name: 'v0.18.0', assets: [{ name: 'latest-mac.yml', browser_download_url: 'yml' }] },
      {
        tag_name: 'v0.17.1',
        assets: [{ name: 'Surco-0.17.1-arm64.dmg', browser_download_url: 'dmg' }],
      },
    ]
    expect(pickInstallerRelease(releases, 'arm64.dmg')?.tag_name).toBe('v0.17.1')
  })

  it('uses the newest release once its installer is there', () => {
    const releases = [
      { tag_name: 'v0.18.0', assets: [{ name: 'Surco-0.18.0-arm64.dmg', browser_download_url: 'd' }] },
      { tag_name: 'v0.17.1', assets: [{ name: 'Surco-0.17.1-arm64.dmg', browser_download_url: 'p' }] },
    ]
    expect(pickInstallerRelease(releases, 'arm64.dmg')?.tag_name).toBe('v0.18.0')
  })

  it('returns undefined when no release carries the installer', () => {
    expect(pickInstallerRelease([{ tag_name: 'v0.1.0', assets: [] }], '.exe')).toBeUndefined()
  })
})
