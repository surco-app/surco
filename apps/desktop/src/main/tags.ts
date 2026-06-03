import {
  Id3v2AttachmentFrame,
  Id3v2FrameIdentifiers,
  Picture,
  PictureType,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import type { TrackMetadata } from '../shared/types'

// Traktor stores its cue points and beatgrid inside the audio file itself, in an
// ID3 GEOB frame described "TRAKTOR4". ffmpeg rebuilds the whole tag even on a
// stream copy and re-emits only the frames it understands, so GEOB is silently
// dropped. To keep the cues we must edit the existing tag in place instead of
// re-muxing — but only for the ID3-based containers where this is proven safe.
// WAV/FLAC do not round-trip GEOB cleanly through TagLib, so they stay on ffmpeg.
const ID3_IN_PLACE = new Set(['.mp3', '.aiff'])

export function preservesCuesInPlace(ext: string): boolean {
  return ID3_IN_PLACE.has(ext.toLowerCase())
}

const toNumber = (value: string): number => {
  const n = Number(value)
  return value.trim() !== '' && Number.isFinite(n) ? n : 0
}

const toArray = (value: string): string[] => (value.trim() ? [value] : [])

// Overwrites the metadata fields we manage and leaves every other frame — most
// importantly Traktor's GEOB cue/beatgrid blob — untouched. An empty field is
// written as empty so clearing a value in the editor clears it on disk too,
// matching the metadata the ffmpeg path would have produced.
export function writeTags(file: string, meta: TrackMetadata, coverPath?: string): void {
  const f = TagFile.createFromPath(file)
  try {
    const tag = f.tag
    tag.title = meta.title
    tag.performers = toArray(meta.artist)
    tag.album = meta.album
    tag.albumArtists = toArray(meta.albumArtist)
    tag.year = toNumber(meta.year)
    tag.genres = toArray(meta.genre)
    tag.grouping = meta.grouping
    tag.comment = meta.comment
    tag.track = toNumber(meta.trackNumber)
    tag.disc = toNumber(meta.discNumber)
    tag.beatsPerMinute = toNumber(meta.bpm)
    tag.initialKey = meta.key
    tag.remixedBy = meta.remixArtist
    tag.publisher = meta.publisher

    const id3 = f.getTag(TagTypes.Id3v2, true)
    // The catalog number has no standard frame, so it rides the de-facto TXXX
    // "CATALOGNUMBER" one — the same key the ffmpeg path writes.
    id3.setUserTextAsString('CATALOGNUMBER', meta.catalogNumber)

    if (coverPath) {
      // TagLib models APIC and GEOB as the same attachment kind, so the generic
      // `pictures` setter would wipe the GEOB cue frame along with the old art.
      // Removing only APIC and appending the new picture leaves GEOB in place.
      id3.removeFrames(Id3v2FrameIdentifiers.APIC)
      const picture = Picture.fromPath(coverPath)
      picture.type = PictureType.FrontCover
      id3.addFrame(Id3v2AttachmentFrame.fromPicture(picture))
    }

    f.save()
  } finally {
    f.dispose()
  }
}
