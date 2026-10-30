import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAllReleases, fetchInstallerReleasesCached, pickInstallerRelease } from './downloads'

describe('pickInstallerRelease', () => {
  // The reported bug: while a new release is building, its installer isn't uploaded yet, so
  // the button must fall back to the previous build instead of reporting no installer.
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
      {
        tag_name: 'v0.18.0',
        assets: [{ name: 'Surco-0.18.0-arm64.dmg', browser_download_url: 'd' }],
      },
      {
        tag_name: 'v0.17.1',
        assets: [{ name: 'Surco-0.17.1-arm64.dmg', browser_download_url: 'p' }],
      },
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
      {
        tag_name: 'v0.57.0',
        assets: [{ name: 'Surco-0.57.0-arm64.dmg', browser_download_url: 'd' }],
      },
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
    const fetchMock = vi.fn().mockResolvedValueOnce(page(first)).mockResolvedValueOnce(page(second))
    vi.stubGlobal('fetch', fetchMock)

    const releases = await fetchAllReleases('surco-app/surco-releases')

    expect(releases).toHaveLength(102)
    expect(fetchMock.mock.calls[1][0]).toContain('page=2')
  })

  // The daily stats snapshot runs on a shared Actions runner, whose IP may already have
  // spent the 60 unauthenticated requests an hour, so it signs every page with its token.
  it('sends the given headers with every page', async () => {
    const full = Array.from({ length: 100 }, (_, i) => release(`v${i}`))
    const fetchMock = vi.fn().mockResolvedValueOnce(page(full)).mockResolvedValueOnce(page([]))
    vi.stubGlobal('fetch', fetchMock)

    await fetchAllReleases('surco-app/surco-releases', { Authorization: 'Bearer t' })

    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toEqual({ headers: { Authorization: 'Bearer t' } })
    }
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

describe('fetchInstallerReleasesCached', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const installer = {
    tag_name: 'v0.97.0',
    assets: [
      { name: 'Surco-0.97.0-arm64.dmg', browser_download_url: 'https://dl.test/a.dmg', size: 183 },
    ],
  }
  const ok = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) }) as Response

  const stubStorage = () => {
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
  }

  // The button mounts on every page, and the home page mounts it three times (hero,
  // closing CTA, install section). Each mount used to spend its own request against
  // the 60/hour-per-IP limit, so a single visit through home → features → guide →
  // changelog cost a dozen — enough for an office or CGNAT address to hit the 403 that
  // drops visitors onto a raw asset list. The installer URL changes only when a release
  // ships, so one request per session is enough.
  it('serves every extra mount from the session cache', async () => {
    stubStorage()
    const fetchMock = vi.fn().mockResolvedValue(ok([installer]))
    vi.stubGlobal('fetch', fetchMock)

    const first = await fetchInstallerReleasesCached('surco-app/surco-releases')
    const second = await fetchInstallerReleasesCached('surco-app/surco-releases')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  // The cached payload is what the CTA's href, version and size are read from, so a
  // round trip through storage has to preserve the asset fields, not just the tag.
  it('keeps the asset URL and size across the cache round trip', async () => {
    stubStorage()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok([installer])))

    await fetchInstallerReleasesCached('surco-app/surco-releases')
    const cached = await fetchInstallerReleasesCached('surco-app/surco-releases')

    expect(cached[0].assets?.[0]).toEqual({
      name: 'Surco-0.97.0-arm64.dmg',
      browser_download_url: 'https://dl.test/a.dmg',
      size: 183,
    })
  })

  // The home page mounts the button three times, and all three effects run in the same
  // tick — before any of them has written to sessionStorage. The stored copy only helps
  // the NEXT page, so without sharing the in-flight promise the first render still spends
  // one request per mount. Measured: the cache alone left the home page at 2.
  it('shares one in-flight request between mounts that start together', async () => {
    stubStorage()
    const fetchMock = vi.fn().mockResolvedValue(ok([installer]))
    vi.stubGlobal('fetch', fetchMock)

    const [a, b, c] = await Promise.all([
      fetchInstallerReleasesCached('surco-app/surco-releases'),
      fetchInstallerReleasesCached('surco-app/surco-releases'),
      fetchInstallerReleasesCached('surco-app/surco-releases'),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })

  // A failed request must not be cached: the visitor would then be stuck with the
  // outage for the rest of the session even after GitHub recovered, and the button
  // would keep claiming the download is unreachable on every page they open.
  it('does not cache a failed request', async () => {
    stubStorage()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 504 } as Response)
      .mockResolvedValueOnce(ok([installer]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchInstallerReleasesCached('surco-app/surco-releases')).rejects.toThrow()
    expect(await fetchInstallerReleasesCached('surco-app/surco-releases')).toEqual([installer])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
