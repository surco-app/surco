import { open } from 'node:fs/promises'

const MAGIC = 'fLaC'
const PICTURE = 6

// Walks a FLAC file's metadata block headers (skipping each block's body, so it
// reads only a few bytes regardless of file size) and reports whether a PICTURE
// block declares an empty MIME type. Some taggers write exactly that — a
// zero-length MIME string in front of a perfectly good JPEG. ffmpeg's CLI only
// warns and recovers, but Chromium's <audio> demuxer can't pick an image decoder
// for it and aborts opening the entire file ("Unsupported pixel format: -1"), so
// the track plays nothing. We detect it here so playback can serve an art-stripped
// copy; valid pictures and other files are reported false and left untouched.
export async function flacHasUnreadablePicture(filePath: string): Promise<boolean> {
  const fh = await open(filePath, 'r')
  try {
    const header = Buffer.alloc(4)
    if ((await fh.read(header, 0, 4, 0)).bytesRead < 4) return false
    if (header.toString('latin1') !== MAGIC) return false

    let pos = 4
    while (true) {
      if ((await fh.read(header, 0, 4, pos)).bytesRead < 4) return false
      const last = (header[0] & 0x80) !== 0
      const type = header[0] & 0x7f
      const length = header.readUIntBE(1, 3)
      const body = pos + 4

      if (type === PICTURE) {
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
