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
    await expect(downloadCover('https://img.discogs.com/x.jpg')).rejects.toThrow(
      /^SURCO_ERR:coverDownloadFailed/,
    )
    expect(fn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('downloadCover image validation', () => {
  function mockBytes(bytes: number[]): ReturnType<typeof vi.fn> {
    const fn = vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 }))
    vi.stubGlobal('fetch', fn)
    return fn
  }

  // A link dragged from a browser often points at the page the image sat on, not the
  // image — the server answers 200 with HTML. Saving that as .jpg only blows up later
  // inside ffmpeg, so reject it up front on the bytes, not the (absent) content-type.
  it('rejects a URL whose bytes are not a known image', async () => {
    mockBytes([...Buffer.from('<!DOCTYPE html><html></html>')])
    await expect(downloadCover('https://page.example/article')).rejects.toThrow(
      /^SURCO_ERR:coverNotImage/,
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
    // Asserted on the stamped key rather than the sentence: the wording lives in the
    // renderer's catalogue now, in five languages, and none of it reaches here.
    await expect(downloadCover('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      /SURCO_ERR:coverUrlBlocked/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('downloadCover redirects and size', () => {
  const jpeg = () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { status: 200 })
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } })

  // fetch followed redirects on its own, so a public URL answering 302 to the cloud
  // metadata address or a loopback service walked straight past the SSRF check, which
  // only ever saw the first URL. Every hop has to pass it.
  it('refuses a redirect to a blocked address without fetching it', async () => {
    const fn = vi.fn(async () => redirect('http://169.254.169.254/latest/meta-data/'))
    vi.stubGlobal('fetch', fn)
    await expect(downloadCover('https://img.example/cover.jpg')).rejects.toThrow(
      /SURCO_ERR:coverUrlBlocked/,
    )
    expect(fn).toHaveBeenCalledTimes(1)
  })

  // CDNs redirect artwork all the time; checking each hop must not break the ordinary case.
  it('follows a redirect to a public host', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce(redirect('/real/cover.jpg'))
      .mockResolvedValueOnce(jpeg())
    vi.stubGlobal('fetch', fn)
    await expect(downloadCover('https://img.example/cover')).resolves.toMatch(/\.jpg$/)
    expect(fn.mock.calls[1][0]).toBe('https://img.example/real/cover.jpg')
  })

  it('gives up on a redirect loop', async () => {
    const fn = vi.fn(async () => redirect('https://img.example/again'))
    vi.stubGlobal('fetch', fn)
    await expect(downloadCover('https://img.example/again')).rejects.toThrow(
      /SURCO_ERR:coverDownloadFailed/,
    )
    expect(fn.mock.calls.length).toBeLessThan(10)
  })

  // The renderer names the URL and the whole body used to be buffered in the main process:
  // a link to a multi-GB file would have filled memory before the image check ever ran.
  it('stops reading a body past the size cap', async () => {
    let pulled = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(new Uint8Array(1024 * 1024).fill(0xff))
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(endless, { status: 200 })),
    )
    await expect(downloadCover('https://img.example/huge.jpg')).rejects.toThrow(
      /SURCO_ERR:coverDownloadFailed/,
    )
    expect(pulled).toBeLessThan(30)
  })
})
