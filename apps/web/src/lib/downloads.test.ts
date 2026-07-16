import { afterEach, describe, expect, it, vi } from 'vitest'
import { countDownloads, fetchAllReleases, pickInstallerRelease } from './downloads'

describe('countDownloads', () => {
  // Only installers count. The release also carries .zip/.blockmap/.yml assets
  // that electron-updater fetches on every auto-update; counting those would
  // turn update traffic into phantom downloads.
  it('counts only .dmg, .exe and .AppImage assets, ignoring update artifacts', () => {
    const releases = [
      {
        assets: [
          { name: 'Surco-0.1.2-arm64.dmg', download_count: 120 },
          { name: 'Surco-0.1.2-x64.dmg', download_count: 18 },
          { name: 'Surco-0.1.2-Setup.exe', download_count: 40 },
          { name: 'Surco-0.1.2-x86_64.AppImage', download_count: 7 },
          { name: 'Surco-0.1.2-arm64.zip', download_count: 999 },
          { name: 'latest-mac.yml', download_count: 5000 },
          { name: 'latest-linux.yml', download_count: 3000 },
        ],
      },
    ]
    expect(countDownloads(releases)).toBe(185)
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

  // Linux shipped from v0.58.0 on, so the older releases carry no AppImage. A Linux
  // visitor must land on the newest release that actually has one rather than on a
  // mac-only build whose download button would 404.
  it('skips releases published before Linux shipped', () => {
    const releases = [
      {
        tag_name: 'v0.58.0',
        assets: [{ name: 'Surco-0.58.0-x86_64.AppImage', browser_download_url: 'img' }],
      },
      { tag_name: 'v0.57.0', assets: [{ name: 'Surco-0.57.0-arm64.dmg', browser_download_url: 'd' }] },
    ]
    expect(pickInstallerRelease(releases, '.AppImage')?.tag_name).toBe('v0.58.0')
  })
})

describe('fetchAllReleases', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const release = (tag: string) => ({ tag_name: tag, assets: [] })
  const page = (releases: unknown[]) =>
    ({ ok: true, json: () => Promise.resolve(releases) }) as Response

  // GitHub caps per_page at 100 and the repo already has 77 releases; once it
  // crosses 100 a single request would silently drop the oldest releases —
  // exactly the ones holding the early download counts.
  it('follows pagination past the 100-release page size', async () => {
    const first = Array.from({ length: 100 }, (_, i) => release(`v${i}`))
    const second = [release('v100'), release('v101')]
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(first))
      .mockResolvedValueOnce(page(second))
    vi.stubGlobal('fetch', fetchMock)

    const releases = await fetchAllReleases('surco-app/surco-releases')

    expect(releases).toHaveLength(102)
    expect(fetchMock.mock.calls[1][0]).toContain('page=2')
  })

  it('stops after a single short page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(page([release('v0')]))
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchAllReleases('surco-app/surco-releases')).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // A failed later page must not yield a partial sum: undercounting silently is
  // the same bug pagination fixes, so the whole fetch fails instead.
  it('throws when any page fails', async () => {
    const full = Array.from({ length: 100 }, (_, i) => release(`v${i}`))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(full))
      .mockResolvedValueOnce({ ok: false, status: 403 } as Response)
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchAllReleases('surco-app/surco-releases')).rejects.toThrow()
  })
})
