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
  type Id3v2UnknownFrame,
  Id3v2UserTextInformationFrame,
  type Mpeg4AppleTag,
  Picture,
  PictureType,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import {
  ratingToStars,
  starsToRating,
  starsToWmpRating,
  TRAKTOR_RATING_USER,
  WMP_RATING_USER,
} from '../shared/rating'
import type { TrackMetadata } from '../shared/types'
import { decodeBase91, encodeBase91 } from './base91'
import { mixedInKeyCuesToTraktorTree, parseMixedInKeyCues } from './mixedInKey'
import { shiftTraktorCues } from './traktor4'

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

// Containers whose ID3 tag rides inside a RIFF chunk, where TagLib re-parses every
// frame on save (see the cueSource merge in writeTags).
const RIFF_HOSTED = new Set(['.wav'])

// The Vorbis comment FLAC carries Traktor's cue/beatgrid tree in, the counterpart
// of the ID3 PRIV frame owned "TRAKTOR4" — same tree, armored as text.
const FLAC_CUE_FIELD = 'TRAKTOR4'

// Picture.fromPath derives the APIC description from the temp basename
// (surco-cover-proc-<uuid>.jpg), which mp3tag and DJ software display verbatim. Users
// read that internal name as leftover junk, so we override it with the album name —
// the cover is the release's, not the track's. Album-less files fall back to "cover".
function coverName(meta: TrackMetadata): string {
  const base = meta.album
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `${base || 'cover'}.jpg`
}

export function preservesCuesInPlace(ext: string): boolean {
  return ID3_IN_PLACE.has(ext.toLowerCase())
}

// iTunes/Apple Music stores grouping in its own GRP1 frame, not the standard TIT1 that
// Surco (and TagLib's `grouping` property) writes. TagLib doesn't recognise GRP1 — it comes
// back as an UnknownFrame — and neither the bundled ffprobe nor ffmpeg surface it, so a file
// re-saved by Apple Music has a grouping the normal probe read misses. This reads that frame
// directly: an ID3 text frame body is [encoding byte][text], so the byte picks the encoding
// and the rest is the string, trailing NUL stripped. Best-effort — returns '' when there's
// no GRP1, the file can't be opened, or the frame is malformed, so readMeta only uses it as a
// fallback when the probe gave no grouping.
export function readItunesGrouping(file: string): string {
  try {
    const f = TagFile.createFromPath(file)
    try {
      const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
      const grp1 = id3?.frames.find((fr) => fr.frameId.toString() === 'GRP1')
      // No GRP1: fall back to the standard TIT1 frame, which is where TagLib puts a
      // grouping and where every non-iTunes tagger looks for one. A WAV keeps its
      // grouping only in ID3 (RIFF INFO has no field for it), and ffmpeg's WAV demuxer
      // reads INFO — so without this the probe and this fallback would both miss it.
      if (!grp1) return id3?.grouping ?? ''
      const bytes = (grp1 as Id3v2UnknownFrame).data.toByteArray()
      if (bytes.length < 2) return ''
      const encoding = bytes[0]
      const text = Buffer.from(bytes.slice(1))
      // 0 = Latin1, 1/2 = UTF-16 (with/without BOM), 3 = UTF-8. iTunes writes Latin1 or UTF-8.
      const decoded =
        encoding === 3
          ? text.toString('utf8')
          : encoding === 1 || encoding === 2
            ? text.toString('utf16le')
            : text.toString('latin1')
      return decoded.replace(/\0+$/, '')
    } finally {
      f.dispose()
    }
  } catch {
    return ''
  }
}

// The tag fields a WAV can only keep in its ID3 chunk, because RIFF INFO has no field for
// them. A WAV carries both tags at once and ffmpeg's demuxer reads INFO, ignoring ID3 —
// so these come back empty from the probe even though they are on the file. Read straight
// from ID3 through TagLib instead, as a fallback the probe's own values still win over.
// Keeping INFO is what lets Traktor see the track at all (it reads INFO too, and with the
// chunk gone showed the file name as the title); this is the other half of that bargain.
// Best-effort: '' for anything missing, unopenable, or not an ID3 container.
export function readWavId3Extras(file: string): Partial<TrackMetadata> {
  try {
    const f = TagFile.createFromPath(file)
    try {
      const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
      if (!id3) return {}
      const text = (id: string): string => {
        const frame = id3.frames.find((fr) => fr.frameId.toString() === id)
        return frame ? (frame as Id3v2TextInformationFrame).text?.[0]?.trim() || '' : ''
      }
      // Takes the TXXX frames, not the tag — passing the tag throws, and the catch below
      // would turn that into a silent "no extras at all" for every field here.
      const txxx = id3.getFramesByClassType<Id3v2UserTextInformationFrame>(
        Id3v2FrameClassType.UserTextInformationFrame,
      )
      const userText = (desc: string): string =>
        Id3v2UserTextInformationFrame.findUserTextInformationFrame(txxx, desc)?.text?.[0]?.trim() ||
        ''
      return {
        publisher: id3.publisher?.trim() || '',
        grouping: id3.grouping?.trim() || '',
        key: id3.initialKey?.trim() || '',
        bpm: id3.beatsPerMinute ? String(id3.beatsPerMinute) : '',
        remixArtist: id3.remixedBy?.trim() || '',
        mixName: id3.subtitle?.trim() || '',
        isrc: text('TSRC'),
        catalogNumber: userText('CATALOGNUMBER'),
        discogsReleaseId: userText('DISCOGS_RELEASE_ID'),
        energy: userText('ENERGYLEVEL') || userText('ENERGY'),
        style: userText('STYLE'),
        country: userText('COUNTRY'),
        mediaType: userText('MEDIATYPE'),
        mood: userText('MOOD'),
      }
    } finally {
      f.dispose()
    }
  } catch {
    return {}
  }
}

// Traktor's star rating lives in a POPM frame, which the bundled ffprobe never surfaces
// (unlike FLAC's Vorbis RATING comment) — so on MP3/AIFF a rated track read back unrated
// and the editor showed no stars for a file Traktor shows as five. This reads the frame
// directly, preferring Traktor's own user: a file rated in both Traktor and Windows Media
// Player carries two POPM frames whose bytes disagree by design (204 vs 196 for four
// stars), so the star count must not depend on which frame happens to come first.
// Best-effort — returns '' when there's no POPM, no ID3 tag, or the file can't be opened.
export function readPopmRating(file: string): string {
  try {
    const f = TagFile.createFromPath(file)
    try {
      const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
      if (!id3) return ''
      const frames = id3.getFramesByClassType<Id3v2PopularimeterFrame>(
        Id3v2FrameClassType.PopularimeterFrame,
      )
      if (!frames?.length) return ''
      const byte =
        Id3v2PopularimeterFrame.find(frames, TRAKTOR_RATING_USER)?.rating ?? frames[0].rating
      const stars = ratingToStars(byte)
      return stars > 0 ? String(stars) : ''
    } finally {
      f.dispose()
    }
  } catch {
    return ''
  }
}

// A trim moved the audio under the stored cues: shift every position back by
// shiftMs and clamp what remains to maxMs (the trimmed length) when the tail
// was cut too. Millisecond units, like Traktor's own cue positions. `bpm` is the
// track's tempo, which the grid marker needs to keep its phase — without it a
// blob carrying a grid is dropped rather than re-anchored blind.
export interface CueShift {
  shiftMs: number
  maxMs?: number
  bpm?: number
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

// The FLAC counterpart of copyCueFrames. Traktor stores the same cue/beatgrid
// tree there, armored into a TRAKTOR4 Vorbis comment because comments are UTF-8
// text — and unlike ID3, ffmpeg copies that comment through a re-encode
// untouched. So nothing needs carrying over; the only case that needs work is a
// trim, where the surviving comment now measures from a start the file no longer
// has. Decode, re-anchor through the same parser MP3 uses, re-encode in place. A
// tree that can't be re-anchored is cleared rather than left pointing at the
// wrong beats, matching what the ID3 path does with a frame it must drop.
// Best-effort: cue handling never fails an otherwise good conversion.
export function shiftFlacCues(file: string, shift?: CueShift): void {
  if (!shift) return
  try {
    const f = TagFile.createFromPath(file)
    try {
      const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment | null
      const armored = xiph?.getField(FLAC_CUE_FIELD)?.[0]
      if (!xiph || !armored) return
      const patched = shiftTraktorCues(decodeBase91(armored), shift.shiftMs, shift.maxMs, shift.bpm)
      if (patched) xiph.setFieldAsStrings(FLAC_CUE_FIELD, encodeBase91(patched))
      else xiph.removeField(FLAC_CUE_FIELD)
      f.save()
    } finally {
      f.dispose()
    }
  } catch {
    // Same bargain as the ID3 side: never break a successful conversion.
  }
}

// Cues crossing tag families: an ID3 source (MP3/AIFF) encoded to FLAC. Neither of the
// other two paths covers it — copyCueFrames writes ID3 frames a FLAC has no place for, and
// shiftFlacCues only re-anchors a TRAKTOR4 comment that rode the encode by itself, which is
// exactly what an ID3 source never produces (ffmpeg does not translate a PRIV frame into a
// Vorbis comment). So an AIFF crate converted to FLAC silently lost every cue. The PRIV
// frame holds the same tree the FLAC comment armors, so carrying it over is a re-armoring:
// read, re-anchor through the shared parser, write as base91.
// Best-effort, like both siblings: cues never fail an otherwise good conversion.
export function copyCuesToFlac(source: string, dest: string, shift?: CueShift): void {
  try {
    const tree = readTraktorTree(source)
    if (!tree) return
    // A trim has to move every stored position, and only the parsed tree can be re-anchored.
    // Traktor also writes the same payload inside an opaque GEOB blob, which no path here
    // parses; without a trim it needs no re-anchoring, so it still crosses over verbatim,
    // but a trim has to drop it rather than ship cues pointing at the wrong beats — the
    // same bargain the ID3 path already strikes in applyCueShift.
    const anchored = shift ? shiftTraktorCues(tree, shift.shiftMs, shift.maxMs, shift.bpm) : tree
    if (!anchored) return

    const out = TagFile.createFromPath(dest)
    try {
      const xiph = out.getTag(TagTypes.Xiph, true) as XiphComment
      xiph.setFieldAsStrings(FLAC_CUE_FIELD, encodeBase91(anchored))
      out.save()
    } finally {
      out.dispose()
    }
  } catch {
    // Same bargain as copyCueFrames and shiftFlacCues.
  }
}

// The Traktor cue payload out of an ID3 source, or null when there is none to carry.
// Prefers the PRIV frame (raw tree, the shape shiftTraktorCues parses) and falls back to
// the GEOB blob, whose payload sits behind the frame's own header: an encoding byte, then
// NUL-terminated MIME type, filename and description strings.
function readTraktorTree(source: string): Uint8Array | null {
  try {
    const src = TagFile.createFromPath(source)
    try {
      const tag = src.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
      const priv = tag?.frames.find(isTraktorPriv)
      if (priv) return priv.privateData.toByteArray()
      // Every GEOB, not the first: a Mixed In Key file puts "Key" and "Energy" ahead of
      // anything else, so Traktor's object is rarely the one at the front.
      let mikCues: Uint8Array | null = null
      for (const frame of tag?.frames ?? []) {
        if (frame.frameId.toString() !== 'GEOB') continue
        const parts = geobParts(frame.render(4).toByteArray())
        if (!parts) continue
        if (isTraktorGeob(parts.description)) return parts.payload
        // Kept aside rather than returned on the spot: Traktor's own object always wins,
        // and it may still be sitting further down the frame list.
        if (parts.description === MIK_CUE_GEOB) mikCues = translateMixedInKey(parts.payload)
      }
      return mikCues
    } finally {
      src.dispose()
    }
  } catch {
    return null
  }
}

// The NML sync needs the cue tree of the file that was just converted, not the source —
// a trim already re-anchored it there. ID3 (MP3/AIFF) and FLAC armor the same tree two
// different ways, so this decides by what the file actually carries rather than by
// extension: try the ID3 families first, and only open the file again for its Xiph
// comment if that came back empty (a FLAC has no ID3 tag to find in the first place, so
// readTraktorTree is a cheap, correct no-op there). Best-effort like every other cue path
// in this file — an unreadable file or a missing tree both come back as null.
export function readCueTree(file: string): Uint8Array | null {
  const id3Tree = readTraktorTree(file)
  if (id3Tree) return id3Tree
  try {
    const f = TagFile.createFromPath(file)
    try {
      const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment | null
      const armored = xiph?.getField(FLAC_CUE_FIELD)?.[0]
      return armored ? decodeBase91(armored) : null
    } finally {
      f.dispose()
    }
  } catch {
    return null
  }
}

// Splits a rendered GEOB frame into the three NUL-terminated strings that describe the
// stored object and the payload itself: past the 10-byte frame header and the encoding
// byte come MIME type, filename and description.
function geobParts(rendered: Uint8Array): { description: string; payload: Uint8Array } | null {
  let at = 11
  const fields: string[] = []
  for (let field = 0; field < 3; field++) {
    const start = at
    while (at < rendered.length && rendered[at] !== 0) at++
    fields.push(String.fromCharCode(...rendered.subarray(start, at)))
    at++
  }
  if (at >= rendered.length) return null
  return { description: fields[2], payload: rendered.subarray(at) }
}

// GEOB is a generic ID3 container, not Traktor's private frame: Mixed In Key stores "Key",
// "Energy", "CuePoints" and "BeatGrid" there, Serato its "Serato Overview" waveform and
// "Serato Markers2". Taking whichever GEOB came first shipped a 69-byte key string into
// the FLAC's Traktor cue field on a file Mixed In Key had touched — and which object won
// depended on the order the tools happened to write them in, so the same conversion gave
// different results on different tracks. Only Traktor's own object carries a TRMD tree.
function isTraktorGeob(description: string): boolean {
  return description === 'TRAKTOR4'
}

// Mixed In Key's cue object. Its payload is base64'd JSON, not the binary tree Traktor
// reads, so a track analysed only by Mixed In Key reached a FLAC with no cues at all —
// the positions were right there in the file, just in the wrong alphabet.
const MIK_CUE_GEOB = 'CuePoints'

function translateMixedInKey(payload: Uint8Array): Uint8Array | null {
  try {
    const json = Buffer.from(String.fromCharCode(...payload), 'base64').toString('utf8')
    return mixedInKeyCuesToTraktorTree(parseMixedInKeyCues(json))
  } catch {
    return null
  }
}

function isTraktorPriv(frame: Id3v2Frame): frame is Id3v2PrivateFrame {
  return frame instanceof Id3v2PrivateFrame && frame.owner === 'TRAKTOR4'
}

// The frames that carry Traktor's cues/beatgrid: the GEOB blob and the PRIV
// "TRAKTOR4" real Traktor MP3s use. The set to preserve when everything else is
// wiped — readCueFrames clones exactly these, clearExtras keeps exactly these.
function isTraktorCue(frame: Id3v2Frame): boolean {
  return frame.frameId.toString() === 'GEOB' || isTraktorPriv(frame)
}

// The cues a RIFF host can actually hold: Traktor's PRIV, plus Traktor's own GEOB but
// not a foreign one. Read through the same geobParts/isTraktorGeob pair the cue reader
// uses, so "Traktor's object" means one thing in this file. A GEOB whose header won't
// parse is by definition not Traktor's and is the shape that throws on save.
//
// The render() here is not only a read: TagLib parses a frame lazily, and rendering it
// once leaves the object in the parsed state its RIFF save would otherwise reach halfway
// through writing. That is a side effect worth keeping deliberate rather than tidying
// into a cheaper header peek — measured against djotas' file, the four Mixed In Key
// objects throw when saved unrendered and survive when rendered first.
function isRiffSafeCue(frame: Id3v2Frame): boolean {
  if (isTraktorPriv(frame)) return true
  if (frame.frameId.toString() !== 'GEOB') return false
  try {
    const parts = geobParts(frame.render(4).toByteArray())
    return parts !== null && isTraktorGeob(parts.description)
  } catch {
    return false
  }
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
      const cues = tag?.frames.filter(isTraktorCue) ?? []
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
    const patched = shiftTraktorCues(
      frame.privateData.toByteArray(),
      shift.shiftMs,
      shift.maxMs,
      shift.bpm,
    )
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
// `foreignRemoved` names the third-party tags the inspector's per-tag delete marked —
// applied on both ID3 and m4a regardless of clearExtras, unlike the fields above.
export function writeTags(
  file: string,
  meta: TrackMetadata,
  coverPath?: string,
  removeCover = false,
  cueSource?: string,
  cueShift?: CueShift,
  clearExtras = false,
  foreignRemoved: string[] = [],
): void {
  const f = TagFile.createFromPath(file)
  try {
    const tag = f.tag
    // M4A carries iTunes atoms in a single ILST box with no per-frame overwrite
    // semantics like ID3's frame IDs — Tag.clear() (AppleTag: _ilstBox.clearChildren())
    // is the only way to reach a foreign atom the app doesn't manage, so on clearExtras
    // it must run before the generic assignments below repopulate the managed atoms.
    if (extname(file).toLowerCase() === '.m4a' && clearExtras) tag.clear()
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

    // TagLib maps `publisher` to Vorbis ORGANIZATION, the canonical name for the record
    // label — and the one name Traktor does not look at. It reads LABEL, so on FLAC the
    // label Surco wrote was invisible there while the same field on MP3 (ID3 TPUB) worked,
    // which is exactly the asymmetry djotas hit. Write both aliases: LABEL for Traktor,
    // PUBLISHER for the shops and taggers that use it (his purchased FLACs carry both).
    // Cleared together too, or emptying the field in the editor leaves the old label in
    // whichever alias the next program happens to read.
    if (extname(file).toLowerCase() === '.flac') {
      const xiph = f.getTag(TagTypes.Xiph, true) as XiphComment
      for (const field of ['LABEL', 'PUBLISHER']) {
        if (meta.publisher.trim()) xiph.setFieldAsStrings(field, meta.publisher)
        else xiph.removeField(field)
      }
    }

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
      // Foreign tags the user marked in the inspector: same "----" freeform route
      // TagLib itself uses to write every managed atom it doesn't have a dedicated
      // box for (ReplayGain, MusicBrainz ids…), under the MEAN every tagger writes.
      // Applies always, like the ID3 route below — independent of clearExtras.
      const apple = f.tag as Mpeg4AppleTag
      for (const name of foreignRemoved) apple.setItunesStrings('com.apple.iTunes', name)
      f.save()
      return
    }

    const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
    // Pin to ID3v2.3 so the tag matches the ffmpeg conversion path (-id3v2_version 3)
    // and stays readable on the CDJ/rekordbox/Serato setups that mishandle v2.4 —
    // and, for WAV, in mp3tag, which ignores a v2.4 "id3 " chunk entirely.
    if (ID3_V23.has(extname(file).toLowerCase())) id3.version = 3
    // "Empty every metadata field" must reach frames the app never wrote — a foreign
    // NOTES/COMM/TXXX another tool left behind survived the managed-field overwrite and
    // read as junk the user couldn't clear. On clearExtras, drop every frame up front,
    // including the Traktor cue frames (GEOB, PRIV "TRAKTOR4") — "clear everything" means
    // the beatgrid too; a cueSource merge below still re-injects them for a carry-over
    // conversion. Iterate a copy since removeFrame mutates id3.frames as it goes.
    if (clearExtras) for (const frame of id3.frames.slice()) id3.removeFrame(frame)
    // The foreign tags the user marked in the inspector: remove them by name. Covers
    // the free-text TXXX route (setUserText with '' clears it) and any frame whose id
    // matches the name outright. Applies always, not just on clearExtras.
    for (const name of foreignRemoved) {
      setUserText(id3, name, '')
      const upper = name.toUpperCase()
      for (const fr of id3.frames.filter(
        (frame) => frame.frameId.toString().toUpperCase() === upper,
      )) {
        id3.removeFrame(fr)
      }
    }
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

    // Skipped on clearExtras: the frame wipe above already dropped the cue, and a
    // re-encode to a different ID3 format folds this carry-over into the same
    // writeTags call as the rating (see ffmpeg.ts), so without this guard "clear
    // everything" would silently bring the cue right back.
    if (cueSource && !clearExtras) {
      const carried = applyCueShift(readCueFrames(cueSource), cueShift)
      // A GEOB is an opaque blob everywhere else, but RiffFile.save() renders every
      // frame through TagLib's attachment parser, which throws "Argument out of range"
      // on objects it cannot read as an attachment. Serato's and Mixed In Key's are
      // exactly that, and real crates carry them alongside Traktor's — djotas' own file
      // has four — so one foreign object killed the whole conversion. Traktor's own
      // GEOB renders fine, so a WAV keeps that one (and the PRIV) and drops only what
      // would take the file down with it.
      const cues = RIFF_HOSTED.has(extname(file).toLowerCase())
        ? carried.filter(isRiffSafeCue)
        : carried
      if (cues.length > 0) {
        removeCueFrames(id3)
        for (const frame of cues) id3.addFrame(frame)
      }
    }

    // A WAV can hold both a RIFF "INFO" chunk and an ID3v2 "id3 " chunk, and which one a
    // program reads is not ours to choose: ffmpeg's WAV demuxer reads INFO and ignores the
    // ID3 text frames, and so does Traktor. This used to delete INFO, so a converted WAV
    // showed no artist and its file name as the title in Traktor while mp3tag (an ID3
    // reader) showed it correctly — djotas hit exactly that. The deletion was there because
    // INFO has no grouping field, so a stale chunk left grouping unreadable on re-import;
    // but it traded a whole DJ program's view of the file for one field. Both tags stay
    // now. ffmpeg wrote this conversion's own INFO from the same metadata moments ago, so
    // nothing here is stale, and grouping keeps round-tripping through ID3 via the TIT1
    // fallback in readItunesGrouping.

    f.save()
  } finally {
    f.dispose()
  }
}
