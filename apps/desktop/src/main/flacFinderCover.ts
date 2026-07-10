import { closeSync, openSync, readSync, renameSync, rmSync, writeSync } from 'node:fs'
import { Id3v2AttachmentFrame, Id3v2Tag, Picture, PictureType } from 'node-taglib-sharp'
import type { TrackMetadata } from '../shared/types'

// macOS Finder and QuickLook never read FLAC's own PICTURE block, so a FLAC with
// perfectly good embedded art shows a generic icon. They do read ID3v2, and FLAC
// decoders (libFLAC, ffmpeg — and through it Chromium's <audio>) skip a leading
// ID3 tag, so prepending one that carries the cover is the one way to get Finder
// thumbnails without breaking playback. Technically off-spec (a FLAC file should
// start with "fLaC"), which is why this only runs behind the macOS-only opt-in
// setting. Title/artist/album ride along so Finder's preview pane names the file
// like the djotas-style tools users already run by hand; the Vorbis comments and
// the PICTURE block after the header stay the canonical tags.
export function prependFlacId3(file: string, meta: TrackMetadata, coverPath: string): void {
  const tag = Id3v2Tag.fromEmpty()
  // v2.3, matching every other ID3 tag Surco writes (see tags.ts) — v2.4 trips
  // older readers and buys nothing here.
  tag.version = 3
  tag.title = meta.title
  tag.performers = meta.artist ? [meta.artist] : []
  tag.album = meta.album
  const picture = Picture.fromPath(coverPath)
  picture.type = PictureType.FrontCover
  tag.addFrame(Id3v2AttachmentFrame.fromPicture(picture))
  const header = tag.render().toByteArray()

  // Prepending means rewriting the whole file; stream it in chunks so a 24/96 rip
  // never has to fit in memory, then rename over the original so it lands whole or
  // not at all — same temp-write pattern as the conversion itself.
  const tmp = `${file}.id3tmp`
  try {
    const src = openSync(file, 'r')
    try {
      const out = openSync(tmp, 'w')
      try {
        writeSync(out, header)
        const buf = Buffer.alloc(1 << 22)
        while (true) {
          const read = readSync(src, buf, 0, buf.length, null)
          if (read <= 0) break
          writeSync(out, buf, 0, read)
        }
      } finally {
        closeSync(out)
      }
    } finally {
      closeSync(src)
    }
    renameSync(tmp, file)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}
