import { extname } from 'node:path'
import {
  Id3v2AttachmentFrame,
  Id3v2FrameClassType,
  Id3v2FrameIdentifiers,
  Id3v2PopularimeterFrame,
  type Id3v2Tag,
  Id3v2UserTextInformationFrame,
  Picture,
  PictureType,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { starsToRating, TRAKTOR_RATING_USER } from '../shared/rating'
import type { TrackMetadata } from '../shared/types'

// The ID3 containers we edit in place: forcing the global Id3v2Settings would also break
// WAV (its RIFF "id3 " chunk requires v2.4), so the version is pinned per tag below.
const ID3_V23 = new Set(['.mp3', '.aiff'])

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

// node-taglib-sharp keeps its TXXX user-text accessors private, but the catalog
// number lives in a TXXX frame. This mirrors the library's own setUserTextAsString
// through its public frame API: an empty value clears the frame, otherwise it is
// created if missing and its text replaced.
function setUserText(tag: Id3v2Tag, description: string, text: string): void {
  const frames = tag.getFramesByClassType<Id3v2UserTextInformationFrame>(
    Id3v2FrameClassType.UserTextInformationFrame,
  )
  let frame = Id3v2UserTextInformationFrame.findUserTextInformationFrame(frames, description)
  if (!text) {
    if (frame) tag.removeFrame(frame)
    return
  }
  if (!frame) {
    frame = Id3v2UserTextInformationFrame.fromDescription(description)
    tag.addFrame(frame)
  }
  frame.text = text.split(';')
}

// Writes the Traktor star rating into a POPM frame (0–255 in steps of 51). An
// empty rating is left untouched rather than cleared, so converting a file never
// wipes a rating we didn't surface in the editor.
function setRating(tag: Id3v2Tag, stars: string): void {
  const n = Number(stars)
  if (!stars.trim() || !Number.isFinite(n) || n <= 0) return
  const frames = tag.getFramesByClassType<Id3v2PopularimeterFrame>(
    Id3v2FrameClassType.PopularimeterFrame,
  )
  let frame = Id3v2PopularimeterFrame.find(frames, TRAKTOR_RATING_USER)
  if (!frame) {
    frame = Id3v2PopularimeterFrame.fromUser(TRAKTOR_RATING_USER)
    tag.addFrame(frame)
  }
  frame.rating = starsToRating(n)
}

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

    const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
    // Pin MP3/AIFF to ID3v2.3 so an in-place edit matches the ffmpeg conversion path
    // (-id3v2_version 3) and stays readable on the CDJ/rekordbox/Serato setups that
    // mishandle v2.4. WAV is left alone — its RIFF "id3 " chunk needs v2.4.
    if (ID3_V23.has(extname(file).toLowerCase())) id3.version = 3
    // The catalog number has no standard frame, so it rides the de-facto TXXX
    // "CATALOGNUMBER" one — the same key the ffmpeg path writes.
    setUserText(id3, 'CATALOGNUMBER', meta.catalogNumber)
    // Same TXXX treatment for the Discogs release id — no standard frame either.
    setUserText(id3, 'DISCOGS_RELEASE_ID', meta.discogsReleaseId ?? '')
    setRating(id3, meta.rating ?? '')

    if (coverPath) {
      // TagLib models APIC and GEOB as the same attachment kind, so the generic
      // `pictures` setter would wipe the GEOB cue frame along with the old art.
      // Removing only APIC and appending the new picture leaves GEOB in place.
      id3.removeFrames(Id3v2FrameIdentifiers.APIC)
      const picture = Picture.fromPath(coverPath)
      picture.type = PictureType.FrontCover
      id3.addFrame(Id3v2AttachmentFrame.fromPicture(picture))
    }

    // A WAV can hold both a RIFF "INFO" chunk and an ID3v2 "id3 " chunk, but
    // ffmpeg's WAV demuxer reads tags from INFO and ignores the ID3 text frames
    // (the artwork still comes through as a stream). INFO has no field for
    // grouping, so leaving it in place would make grouping unreadable on
    // re-import. Dropping INFO leaves a single ID3 tag that round-trips fully.
    // It is a no-op on MP3/AIFF, which never carry a RIFF INFO tag.
    f.removeTags(TagTypes.RiffInfo)

    f.save()
  } finally {
    f.dispose()
  }
}
