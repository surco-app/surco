import { extname } from 'node:path'
import {
  ByteVector,
  Id3v2AttachmentFrame,
  type Id3v2Frame,
  Id3v2FrameClassType,
  Id3v2FrameIdentifiers,
  Id3v2PopularimeterFrame,
  Id3v2PrivateFrame,
  type Id3v2Tag,
  Id3v2TextInformationFrame,
  Id3v2UserTextInformationFrame,
  Picture,
  PictureType,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { shiftTraktorCues } from './traktor4'
import {
  starsToRating,
  starsToWmpRating,
  TRAKTOR_RATING_USER,
  WMP_RATING_USER,
} from '../shared/rating'
import type { TrackMetadata } from '../shared/types'

// Every ID3 container we write gets v2.3, pinned per tag rather than through the
// global Id3v2Settings so a library upgrade can't silently change other tag kinds.
// WAV included: mp3tag only reads a RIFF "id3 " chunk when it holds v2.3, so the
// v2.4 we used to leave there made Surco-tagged WAVs look empty in it.
const ID3_V23 = new Set(['.mp3', '.aiff', '.wav'])

// Traktor stores its cue points and beatgrid inside the audio file itself, in an
// ID3 GEOB frame described "TRAKTOR4". ffmpeg rebuilds the whole tag even on a
// stream copy and re-emits only the frames it understands, so GEOB is silently
// dropped. To keep the cues we must edit the existing tag in place instead of
// re-muxing — but only for the ID3-based containers where this is proven safe.
// WAV/FLAC do not round-trip GEOB cleanly through TagLib, so they stay on ffmpeg.
const ID3_IN_PLACE = new Set(['.mp3', '.aiff'])

// Picture.fromPath derives the APIC description from the temp basename
// (surco-cover-proc-<uuid>.jpg), which mp3tag and DJ software display verbatim. Users
// read that internal name as leftover junk, so we override it with the album name —
// the cover is the release's, not the track's. Album-less files fall back to "cover".
function coverName(meta: TrackMetadata): string {
  const base = meta.album.replace(/[/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
  return `${base || 'cover'}.jpg`
}

export function preservesCuesInPlace(ext: string): boolean {
  return ID3_IN_PLACE.has(ext.toLowerCase())
}

// A trim moved the audio under the stored cues: shift every position back by
// shiftMs and clamp what remains to maxMs (the trimmed length) when the tail
// was cut too. Millisecond units, like Traktor's own cue positions.
export interface CueShift {
  shiftMs: number
  maxMs?: number
}

// Carries Traktor's cue/beatgrid frames from a source file into a freshly
// converted one. Traktor stores them in an ID3 PRIV frame owned "TRAKTOR4"
// (what real Traktor-written MP3s carry) and historically in GEOB; ffmpeg's
// re-encode drops both. A constant gain never shifts the cues in time, so
// without a trim the frames are cloned verbatim. With a trim the audio moved
// under them: PRIV bodies are re-anchored through shiftTraktorCues (checksum
// recomputed, or Traktor ignores the frame), and a frame that can't be
// re-anchored — an unknown variant, or the opaque GEOB blobs — is dropped
// rather than carried provably pointing at the wrong beats. Best-effort — any
// failure leaves the (already valid) output as-is rather than aborting the
// conversion. Only meaningful for ID3 containers.
export function copyCueFrames(source: string, dest: string, shift?: CueShift): void {
  try {
    const cues = applyCueShift(readCueFrames(source), shift)
    if (cues.length === 0) return

    const out = TagFile.createFromPath(dest)
    try {
      const tag = out.getTag(TagTypes.Id3v2, true) as Id3v2Tag
      removeCueFrames(tag)
      for (const frame of cues) tag.addFrame(frame)
      out.save()
    } finally {
      out.dispose()
    }
  } catch {
    // Cue preservation is a bonus; never let it break a successful conversion.
  }
}

function isTraktorPriv(frame: Id3v2Frame): frame is Id3v2PrivateFrame {
  return frame instanceof Id3v2PrivateFrame && frame.owner === 'TRAKTOR4'
}

// Drops the frames a cue carry-over is about to rewrite: every GEOB, and the
// Traktor PRIV specifically — other PRIV owners on the destination stay.
function removeCueFrames(tag: Id3v2Tag): void {
  tag.removeFrames(Id3v2FrameIdentifiers.GEOB)
  for (const frame of tag.frames.filter(isTraktorPriv)) tag.removeFrame(frame)
}

// The read half of copyCueFrames, also used by writeTags' cueSource merge: clones
// the source's GEOB frames (opaque blobs TagLib's attachment parser can choke on,
// so never parsed) plus the PRIV "TRAKTOR4" frame real Traktor MP3s carry.
// Best-effort like the copy itself — an unreadable source yields no cues.
function readCueFrames(source: string): Id3v2Frame[] {
  try {
    const src = TagFile.createFromPath(source)
    try {
      const tag = src.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
      const cues =
        tag?.frames.filter((fr) => fr.frameId.toString() === 'GEOB' || isTraktorPriv(fr)) ?? []
      return cues.map((fr) => fr.clone())
    } finally {
      src.dispose()
    }
  } catch {
    return []
  }
}

// Applies a trim's re-anchoring to the carried frames; without a shift they pass
// through verbatim (a plain format change or gain never moves the cues in time).
function applyCueShift(frames: Id3v2Frame[], shift?: CueShift): Id3v2Frame[] {
  if (!shift) return frames
  return frames.flatMap((frame) => {
    if (!isTraktorPriv(frame)) return []
    const patched = shiftTraktorCues(frame.privateData.toByteArray(), shift.shiftMs, shift.maxMs)
    if (!patched) return []
    frame.privateData = ByteVector.fromByteArray(patched)
    return [frame]
  })
}

const toNumber = (value: string): number => {
  const n = Number(value)
  return value.trim() !== '' && Number.isFinite(n) ? n : 0
}

// The year field imports the source's `date` tag verbatim, which in FLAC/WAV rips is
// often a full date ("2024-03-01") that Number() turns into NaN — writing 0 and
// destroying the year. Take the leading 4-digit year; anything else falls back to the
// plain numeric parse.
const toYear = (value: string): number => {
  const dated = value.trim().match(/^(\d{4})\b/)
  return dated ? Number(dated[1]) : toNumber(value)
}

const toArray = (value: string): string[] => (value.trim() ? [value] : [])

// The numeric track for TagLib's generic setter. A vinyl position ("A2") is not a
// number, so its digits are all that can ride the numeric slots (MP4's trkn atom
// holds integers only); the ID3 path rewrites the full text afterwards.
const toTrackNumber = (value: string): number => {
  const n = toNumber(value)
  return n || toNumber(value.replace(/\D/g, ''))
}

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

// Upserts one POPM frame (keyed by its user/email) with the given 0–255 byte.
function setPopm(tag: Id3v2Tag, user: string, byte: number): void {
  const frames = tag.getFramesByClassType<Id3v2PopularimeterFrame>(
    Id3v2FrameClassType.PopularimeterFrame,
  )
  let frame = Id3v2PopularimeterFrame.find(frames, user)
  if (!frame) {
    frame = Id3v2PopularimeterFrame.fromUser(user)
    tag.addFrame(frame)
  }
  frame.rating = byte
}

// Writes the star rating into TWO POPM frames so it round-trips in both worlds:
// Traktor (its own user, linear steps of 51) and Windows Media Player / foobar's
// %RATING WMP% (the "Windows Media Player 9 Series" user, non-linear ramp). An
// empty rating is left untouched rather than cleared, so converting a file never
// wipes a rating we didn't surface in the editor — unless `clear` is set, the
// "clear metadata" intent that wants the rating gone like every other field.
function setRating(tag: Id3v2Tag, stars: string, clear: boolean): void {
  const n = Number(stars)
  if (!stars.trim() || !Number.isFinite(n) || n <= 0) {
    if (clear) tag.removeFrames(Id3v2FrameIdentifiers.POPM)
    return
  }
  setPopm(tag, TRAKTOR_RATING_USER, starsToRating(n))
  setPopm(tag, WMP_RATING_USER, starsToWmpRating(n))
}

// Overwrites the metadata fields we manage and leaves every other frame — most
// importantly Traktor's GEOB cue/beatgrid blob — untouched. An empty field is
// written as empty so clearing a value in the editor clears it on disk too,
// matching the metadata the ffmpeg path would have produced. `removeCover` drops
// the embedded art with no replacement, for when the user clears the artwork.
// `cueSource` carries the cue frames over from that file in this same save —
// TagLib's save can rewrite the whole file, so a conversion that needs both the
// rating and the cues merges them into one pass instead of rewriting a 100MB+
// AIFF twice. `cueShift` re-anchors them when a trim moved the audio, exactly
// like copyCueFrames. ID3 targets only; the m4a early-return below ignores it,
// matching copyCueFrames' scope. `clearExtras` is the "clear metadata" intent: it
// wipes the rating that would otherwise be preserved-on-empty (the cover already
// goes via removeCover), so a cleared file keeps none of the fields we manage.
export function writeTags(
  file: string,
  meta: TrackMetadata,
  coverPath?: string,
  removeCover = false,
  cueSource?: string,
  cueShift?: CueShift,
  clearExtras = false,
): void {
  const f = TagFile.createFromPath(file)
  try {
    const tag = f.tag
    tag.title = meta.title
    tag.performers = toArray(meta.artist)
    tag.album = meta.album
    tag.albumArtists = toArray(meta.albumArtist)
    tag.year = toYear(meta.year)
    tag.genres = toArray(meta.genre)
    tag.grouping = meta.grouping
    tag.comment = meta.comment
    tag.track = toTrackNumber(meta.trackNumber)
    tag.disc = toNumber(meta.discNumber)
    tag.beatsPerMinute = toNumber(meta.bpm)
    tag.initialKey = meta.key
    tag.remixedBy = meta.remixArtist
    tag.publisher = meta.publisher
    tag.composers = toArray(meta.composer ?? '')
    tag.isrc = meta.isrc ?? ''
    tag.subtitle = meta.mixName ?? ''
    tag.isCompilation = meta.compilation === '1'

    // M4A carries iTunes atoms, not ID3: the generic assignments above cover it
    // (TagLib maps bpm to tmpo, grouping to ©grp…), the cover rides the covr atom via
    // the generic pictures setter, and the ID3-only extras (POPM rating, TXXX catalog,
    // TDOR) have no MP4 home — forcing an Id3v2 tag into an MP4 file would corrupt it.
    if (extname(file).toLowerCase() === '.m4a') {
      if (coverPath || removeCover) f.tag.pictures = []
      if (coverPath) {
        const picture = Picture.fromPath(coverPath)
        picture.type = PictureType.FrontCover
        f.tag.pictures = [picture]
      }
      f.save()
      return
    }

    const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
    // Pin to ID3v2.3 so the tag matches the ffmpeg conversion path (-id3v2_version 3)
    // and stays readable on the CDJ/rekordbox/Serato setups that mishandle v2.4 —
    // and, for WAV, in mp3tag, which ignores a v2.4 "id3 " chunk entirely.
    if (ID3_V23.has(extname(file).toLowerCase())) id3.version = 3
    // The catalog number has no standard frame, so it rides the de-facto TXXX
    // "CATALOGNUMBER" one — the same key the ffmpeg path writes.
    setUserText(id3, 'CATALOGNUMBER', meta.catalogNumber)
    // Same TXXX treatment for the Discogs release id — no standard frame either.
    setUserText(id3, 'DISCOGS_RELEASE_ID', meta.discogsReleaseId ?? '')
    // Original year has no TagLib property, so it rides the raw frame. The TDOR
    // identifier is version-aware: on the v2.3 tags pinned above it renders as
    // TORY, its v2.3 predecessor.
    id3.removeFrames(Id3v2FrameIdentifiers.TDOR)
    if (meta.originalYear?.trim()) {
      const tory = Id3v2TextInformationFrame.fromIdentifier(Id3v2FrameIdentifiers.TDOR)
      tory.text = [meta.originalYear]
      id3.addFrame(tory)
    }
    setRating(id3, meta.rating ?? '', clearExtras)
    // Quick Tag's judgement fields, both on the TXXX route. Mood's standard frame
    // (TMOO) is ID3v2.4-only — TagLib has no v2.3 equivalent for it, so on the v2.3
    // tags pinned above it would be silently dropped on save. TXXX "MOOD" is what
    // ffmpeg writes for a mood tag anyway, and what mp3tag and Traktor read. Energy
    // has no standard frame at all; TXXX "ENERGY" is Mixed In Key's key.
    setUserText(id3, 'MOOD', meta.mood ?? '')
    setUserText(id3, 'ENERGY', meta.energy ?? '')

    // A vinyl-position track number ("A2") is text the numeric tag.track setter
    // above cannot hold — it wrote the bare digits. Rewrite the TRCK frame with the
    // verbatim value so the side position survives, matching what the ffmpeg
    // conversion path writes with `-metadata track=`.
    if (/[A-Za-z]/.test(meta.trackNumber)) {
      id3.removeFrames(Id3v2FrameIdentifiers.TRCK)
      const trck = Id3v2TextInformationFrame.fromIdentifier(Id3v2FrameIdentifiers.TRCK)
      trck.text = [meta.trackNumber]
      id3.addFrame(trck)
    }

    if (coverPath || removeCover) {
      // TagLib models APIC and GEOB as the same attachment kind, so the generic
      // `pictures` setter would wipe the GEOB cue frame along with the old art.
      // Removing only APIC leaves GEOB in place; the new picture (if any) is then
      // appended, so removeCover with no coverPath simply clears the art.
      id3.removeFrames(Id3v2FrameIdentifiers.APIC)
    }
    if (coverPath) {
      const picture = Picture.fromPath(coverPath)
      picture.type = PictureType.FrontCover
      picture.description = coverName(meta)
      id3.addFrame(Id3v2AttachmentFrame.fromPicture(picture))
    }

    if (cueSource) {
      const cues = applyCueShift(readCueFrames(cueSource), cueShift)
      if (cues.length > 0) {
        removeCueFrames(id3)
        for (const frame of cues) id3.addFrame(frame)
      }
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
