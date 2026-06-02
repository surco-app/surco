import { describe, expect, it } from 'vitest'
import { countDownloads } from './downloads'

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
