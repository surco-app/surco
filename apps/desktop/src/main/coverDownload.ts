import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { errorWithKey } from '../shared/errorKeys'
import { activity } from './activity'
import { REQUEST_TIMEOUT_MS, USER_AGENT } from './http'
import { isBlockedFetchUrl } from './navigation'
import { tmpName } from './tmp'

// Generic artwork fetching, kept separate from the Discogs search adapter that used to
// host it: any cover URL (a Discogs image, a Bandcamp art_id, a link dragged from a
// browser) resolves to a local file through here, so nothing has to depend on the
// Discogs module just to download a picture.

// Sniffs the image type from the leading magic bytes, independent of the URL's
// extension or a content-type header (servers lie, and a URL dragged from a browser
// often carries none). Returns undefined when the bytes are not a known image — e.g. a
// hotlink-protection or article HTML page served in place of the picture, which is
// exactly what a link dragged from a browser can resolve to. ffmpeg can decode all four.
export function imageExt(buf: Buffer): 'jpg' | 'png' | 'gif' | 'webp' | undefined {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length >= 8 && buf.toString('latin1', 0, 8) === '\x89PNG\r\n\x1a\n') return 'png'
  const head6 = buf.toString('latin1', 0, 6)
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif'
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'webp'
  return undefined
}

// Far past any real artwork; the cap only stops a renderer-named URL that points at a huge
// file from being buffered whole into the main process.
const MAX_COVER_BYTES = 20 * 1024 * 1024
const MAX_REDIRECTS = 5

// Redirects are followed by hand so every hop passes the SSRF check: fetch following them
// itself let a public URL bounce the main process onto a loopback or metadata address.
async function fetchChecked(url: string): Promise<Response> {
  let current = url
  for (let hop = 0; ; hop++) {
    const res = await fetch(current, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'manual',
    })
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (!location) return res
    if (hop === MAX_REDIRECTS) throw errorWithKey('coverDownloadFailed', String(res.status))
    current = new URL(location, current).toString()
    if (isBlockedFetchUrl(current)) throw errorWithKey('coverUrlBlocked', current)
  }
}

async function readCapped(res: Response): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of res.body ?? []) {
    total += chunk.length
    if (total > MAX_COVER_BYTES) throw errorWithKey('coverDownloadFailed', 'too large')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function downloadCover(url: string): Promise<string> {
  // The renderer names this URL, so refuse the SSRF-shaped ones (loopback, cloud
  // metadata, private ranges) before the trusted main process ever connects.
  if (isBlockedFetchUrl(url)) throw errorWithKey('coverUrlBlocked', url)
  return activity.track(
    'cover',
    'activity.downloadCover',
    async () => {
      const res = await fetchChecked(url)
      if (!res.ok) throw errorWithKey('coverDownloadFailed', String(res.status))
      const buf = await readCapped(res)
      // Trust the bytes, not the extension: a URL that resolves to an HTML page (the common
      // outcome of a link dragged from a browser) would otherwise be saved as .jpg and only
      // blow up later inside ffmpeg with an inscrutable "No JPEG data found".
      const ext = imageExt(buf)
      if (!ext) throw errorWithKey('coverNotImage', url)
      const path = join(tmpdir(), tmpName('cover', ext))
      await writeFile(path, buf)
      return path
    },
    { detail: url },
  )
}
