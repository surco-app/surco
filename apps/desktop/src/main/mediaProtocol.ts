import type { ReadStream } from 'node:fs'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { isRecoveryUrl, mediaMimeType, mediaPathFromUrl, parseRange } from '../shared/media'
import { coverThumbPathOf } from './coverThumbs'
import { traktorCoverFile, traktorCoverIdOf, traktorCoverPng } from './traktorCoverCache'

export interface MediaProtocolDeps {
  isAllowed: (path: string) => boolean
  traktorReadPath: () => string
  resolvePlayable: (path: string) => Promise<string>
  resolveRecovered: (path: string) => Promise<string>
  trackMediaStream: (requestedPath: string, stream: ReadStream) => void
}

// Serve the local audio file ourselves with real HTTP range support: the
// <audio> element seeks by re-requesting a byte range, and it only honours the
// jump when the server answers 206 with Content-Range. Streaming the exact
// slice (rather than net.fetch'ing the whole file:// URL, which ignores Range)
// is what makes scrubbing work.
export async function serveMedia(req: Request, deps: MediaProtocolDeps): Promise<Response> {
  // Embedded cover thumbnails (see coverThumbs.ts): content-named files in the app's own
  // store, so no media allow-list applies; coverThumbPathOf admits nothing else.
  // A Traktor row's cover, drawn from the thumbnail Traktor keeps in its own cache (see
  // traktorCoverFile): an id resolves inside that cache or not at all.
  const traktorCover = traktorCoverIdOf(req.url)
  if (traktorCover !== null) {
    const file = traktorCoverFile(deps.traktorReadPath(), traktorCover)
    const png = file && traktorCoverPng(file)
    return png
      ? new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } })
      : new Response('Not found', { status: 404 })
  }
  const thumb = coverThumbPathOf(req.url)
  if (thumb) {
    try {
      return new Response(await readFile(thumb), { headers: { 'Content-Type': 'image/jpeg' } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  }
  // Refuse any path the app never handed to the renderer, before resolvePlayable
  // can even probe or transcode it — this is what keeps surco:// from being an
  // arbitrary-file-read primitive.
  const requested = mediaPathFromUrl(req.url)
  if (!deps.isAllowed(requested)) return new Response('Forbidden', { status: 403 })
  // AIFF can't be decoded by the <audio> element, so resolvePlayable swaps it
  // for a transcoded WAV (every other format streams untouched). The recovery
  // flag is the renderer retrying a stream the element rejected — a damaged
  // file re-encoded whole to a WAV it can take. The size, MIME and ranges
  // below all come from the file we actually serve.
  const filePath = isRecoveryUrl(req.url)
    ? await deps.resolveRecovered(requested)
    : await deps.resolvePlayable(requested)
  const { size } = await stat(filePath)
  const type = mediaMimeType(filePath)
  const range = parseRange(req.headers.get('range'), size)
  if (range) {
    const { start, end } = range
    const stream = createReadStream(filePath, { start, end })
    deps.trackMediaStream(requested, stream)
    const body = Readable.toWeb(stream) as ReadableStream
    return new Response(body, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
      },
    })
  }
  const stream = createReadStream(filePath)
  deps.trackMediaStream(requested, stream)
  const body = Readable.toWeb(stream) as ReadableStream
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
  })
}
