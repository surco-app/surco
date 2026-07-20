import { open } from 'node:fs/promises'
import { leadingId3v2Size } from './id3Header'

const MAGIC = 'fLaC'
const PICTURE = 6

// Walks a FLAC file's metadata block headers (skipping each block's body, so it
// reads only a few bytes regardless of file size) and reports whether its embedded
// art is something Chromium's <audio> demuxer chokes on — in which case playback
// serves an art-stripped copy. Two cases trip it, both of which ffmpeg's CLI only
// warns about and recovers from:
//
//  • a PICTURE block with a zero-length MIME string (some taggers write exactly that
//    in front of a perfectly good JPEG) — Chromium can't pick an image decoder and
//    aborts opening the whole file ("Unsupported pixel format: -1");
//  • more than one PICTURE block (Bandcamp FLACs sometimes ship a front AND back
//    cover) — the demuxer only expects one and likewise aborts, so the track that
//    probes fine plays nothing.
//
// A single valid picture, or no picture, is reported false and left untouched.
export async function flacHasUnreadablePicture(filePath: string): Promise<boolean> {
  const fh = await open(filePath, 'r')
  try {
    // A "Finder covers" FLAC starts with an ID3v2 tag before the fLaC marker; skip
    // it, or the guard would silently no-op on exactly the files Surco writes.
    const lead = Buffer.alloc(10)
    const leadRead = (await fh.read(lead, 0, 10, 0)).bytesRead
    if (leadRead < 4) return false
    const skip = leadRead === 10 ? leadingId3v2Size(lead) : 0

    const header = Buffer.alloc(4)
    if ((await fh.read(header, 0, 4, skip)).bytesRead < 4) return false
    if (header.toString('latin1') !== MAGIC) return false

    let pictures = 0
    let pos = skip + 4
    while (true) {
      if ((await fh.read(header, 0, 4, pos)).bytesRead < 4) return false
      const last = (header[0] & 0x80) !== 0
      const type = header[0] & 0x7f
      const length = header.readUIntBE(1, 3)
      const body = pos + 4

      if (type === PICTURE) {
        pictures++
        // A second picture is already enough — Chromium refuses a multi-cover FLAC.
        if (pictures > 1) return true
        // The MIME length is the second 4-byte field of the block (after the
        // 4-byte picture type); a zero there is the malformation we screen for.
        const head = Buffer.alloc(8)
        if ((await fh.read(head, 0, 8, body)).bytesRead < 8) return false
        if (head.readUInt32BE(4) === 0) return true
      }

      if (last) return false
      pos = body + length
    }
  } finally {
    await fh.close()
  }
}
