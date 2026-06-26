import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

export async function downloadCover(url: string): Promise<string> {
  // The renderer names this URL, so refuse the SSRF-shaped ones (loopback, cloud
  // metadata, private ranges) before the trusted main process ever connects.
  if (isBlockedFetchUrl(url)) throw new Error('La URL de la carátula no está permitida')
  return activity.track(
    'cover',
    'activity.downloadCover',
    async () => {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`No se pudo descargar la carátula (${res.status})`)
      const buf = Buffer.from(await res.arrayBuffer())
      // Trust the bytes, not the extension: a URL that resolves to an HTML page (the common
      // outcome of a link dragged from a browser) would otherwise be saved as .jpg and only
      // blow up later inside ffmpeg with an inscrutable "No JPEG data found".
      const ext = imageExt(buf)
      if (!ext) throw new Error('La URL no apunta a una imagen')
      const path = join(tmpdir(), tmpName('cover', ext))
      await writeFile(path, buf)
      return path
    },
    { detail: url },
  )
}
