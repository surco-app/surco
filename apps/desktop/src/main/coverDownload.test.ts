import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadCover } from './coverDownload'

afterEach(() => vi.unstubAllGlobals())

describe('downloadCover timeout', () => {
  // A hung connection (sleep/wake, captive portal) must not leave the download pending
  // forever: the request carries an abort signal so a stalled socket times out instead
  // of hanging the caller.
  it('downloads covers with a timeout guard', async () => {
    const fn = vi.fn(async (_url: string, _opts?: { signal?: unknown }) => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
    }))
    vi.stubGlobal('fetch', fn)
    await expect(downloadCover('https://img.discogs.com/x.jpg')).rejects.toThrow()
    expect(fn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('downloadCover image validation', () => {
  function mockBytes(bytes: number[]): ReturnType<typeof vi.fn> {
    const fn = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => new Uint8Array(bytes).buffer,
    }))
    vi.stubGlobal('fetch', fn)
    return fn
  }

  // A link dragged from a browser often points at the page the image sat on, not the
  // image — the server answers 200 with HTML. Saving that as .jpg only blows up later
  // inside ffmpeg, so reject it up front on the bytes, not the (absent) content-type.
  it('rejects a URL whose bytes are not a known image', async () => {
    mockBytes([...Buffer.from('<!DOCTYPE html><html></html>')])
    await expect(downloadCover('https://page.example/article')).rejects.toThrow(
      /no apunta a una imagen/i,
    )
  })

  // The saved extension follows the magic bytes, not the URL, so a PNG served from a
  // .jpg URL is named correctly for the downstream ffmpeg pass.
  it('names the file by its magic bytes, not the URL', async () => {
    mockBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await expect(downloadCover('https://img.example/cover.jpg')).resolves.toMatch(/\.png$/)
  })

  // SSRF guard: a renderer-named loopback/metadata URL must be refused before any
  // fetch, so the main process never connects to an internal service on its behalf.
  it('refuses an SSRF-shaped URL without fetching it', async () => {
    const fetchMock = mockBytes([0xff, 0xd8, 0xff])
    await expect(downloadCover('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      /no está permitida/i,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
