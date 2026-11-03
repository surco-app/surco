import { extname } from 'node:path'
import {
  ByteVector,
  Id3v2AttachmentFrame,
  type Id3v2Frame,
  type Id3v2Tag,
  type Mpeg4AppleTag,
  Picture,
  PictureType,
  StringType,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import {
  markersFromArmored,
  markersFromGeob,
  readSeratoTempoMap,
  readSeratoTempoMapArmored,
  type SeratoMarkers,
  type SeratoTempoMap,
  seratoArmored,
  seratoGeobBody,
  seratoPayloadOf,
} from '../shared/seratoMarkers'
import { dropBrokenUfids, geobParts, keepGenreParentheses } from './tags'

const DEFAULT_SAMPLE_RATE = 44100
const ID3_EXTENSIONS = new Set(['.mp3', '.aiff', '.aif', '.wav'])
const MARKERS2 = 'Serato Markers2'
const MARKERS_V1 = 'Serato Markers_'
const FLAC_MARKERS2 = 'SERATO_MARKERS_V2'
const SERATO_MEAN = 'com.serato.dj'

function descriptionAndPayload(frame: Id3v2Frame): ReturnType<typeof geobParts> {
  try {
    return geobParts(frame.render(4).toByteArray())
  } catch {
    return null
  }
}

function id3Geob(f: TagFile, description: string): Uint8Array | null {
  const tag = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
  for (const frame of tag?.frames ?? []) {
    if (frame.frameId.toString() !== 'GEOB') continue
    const parts = descriptionAndPayload(frame)
    if (parts?.description === description) return parts.payload
  }
  return null
}

function id3Markers(f: TagFile): SeratoMarkers | null {
  const body = id3Geob(f, MARKERS2)
  return body ? markersFromGeob(body) : null
}

function id3TempoMap(f: TagFile): SeratoTempoMap | null {
  const tag = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
  for (const frame of tag?.frames ?? []) {
    if (frame.frameId.toString() !== 'GEOB') continue
    const parts = descriptionAndPayload(frame)
    if (parts?.description === 'Serato Tempo Map') return readSeratoTempoMap(parts.payload)
  }
  return null
}

function flacTempoMap(f: TagFile): SeratoTempoMap | null {
  const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment | null
  const value = xiph?.getField('SERATO_TEMPO_MAP')?.[0]
  return value ? readSeratoTempoMapArmored(value) : null
}

function m4aTempoMap(f: TagFile): SeratoTempoMap | null {
  const value = (f.tag as Mpeg4AppleTag).getItunesStrings('com.serato.dj', 'tempomap')[0]
  return value ? readSeratoTempoMapArmored(value) : null
}

function tempoReaderFor(ext: string): ((f: TagFile) => SeratoTempoMap | null) | null {
  if (ID3_EXTENSIONS.has(ext)) return id3TempoMap
  if (ext === '.flac') return flacTempoMap
  if (ext === '.m4a' || ext === '.mp4') return m4aTempoMap
  return null
}

function flacMarkers(f: TagFile): SeratoMarkers | null {
  const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment | null
  const value = xiph?.getField(FLAC_MARKERS2)?.[0]
  return value ? markersFromArmored(value) : null
}

function m4aMarkers(f: TagFile): SeratoMarkers | null {
  const value = (f.tag as Mpeg4AppleTag).getItunesStrings(SERATO_MEAN, 'markersv2')[0]
  return value ? markersFromArmored(value) : null
}

function readerFor(ext: string): ((f: TagFile) => SeratoMarkers | null) | null {
  if (ID3_EXTENSIONS.has(ext)) return id3Markers
  if (ext === '.flac') return flacMarkers
  if (ext === '.m4a' || ext === '.mp4') return m4aMarkers
  return null
}

export function readSeratoMarkers(file: string): SeratoMarkers | null {
  const read = readerFor(extname(file).toLowerCase())
  if (!read) return null
  try {
    const f = TagFile.createFromPath(file)
    try {
      return read(f)
    } finally {
      f.dispose()
    }
  } catch {
    return null
  }
}

export function readSeratoTrack(file: string): {
  markers: SeratoMarkers | null
  tempoMap: SeratoTempoMap | null
  durationMs: number
  sampleRate: number
} | null {
  const ext = extname(file).toLowerCase()
  const read = readerFor(ext)
  const readTempo = tempoReaderFor(ext)
  try {
    const f = TagFile.createFromPath(file)
    try {
      return {
        markers: read ? read(f) : null,
        tempoMap: readTempo ? readTempo(f) : null,
        durationMs: f.properties?.durationMilliseconds ?? 0,
        sampleRate: f.properties?.audioSampleRate || DEFAULT_SAMPLE_RATE,
      }
    } finally {
      f.dispose()
    }
  } catch {
    return null
  }
}

function markersSource(f: TagFile, ext: string): Uint8Array | string | null {
  if (ID3_EXTENSIONS.has(ext)) return id3Geob(f, MARKERS2)
  if (ext === '.flac')
    return (
      (f.getTag(TagTypes.Xiph, false) as XiphComment | null)?.getField(FLAC_MARKERS2)?.[0] ?? null
    )
  if (ext === '.m4a' || ext === '.mp4')
    return (f.tag as Mpeg4AppleTag).getItunesStrings(SERATO_MEAN, 'markersv2')[0] ?? null
  return null
}

export function readSeratoPayload(file: string): Uint8Array | null {
  const f = TagFile.createFromPath(file)
  try {
    const source = markersSource(f, extname(file).toLowerCase())
    return source ? seratoPayloadOf(source) : null
  } finally {
    f.dispose()
  }
}

function markers2Frame(payload: Uint8Array): Id3v2AttachmentFrame {
  const picture = Picture.fromFullData(
    ByteVector.fromByteArray(seratoGeobBody(payload)),
    PictureType.NotAPicture,
    'application/octet-stream',
    MARKERS2,
  )
  picture.filename = ''
  const frame = Id3v2AttachmentFrame.fromPicture(picture)
  frame.textEncoding = StringType.Latin1
  return frame
}

function setId3Markers(f: TagFile, ext: string, payload: Uint8Array): void {
  const tag = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
  tag.version = ext === '.mp3' ? 3 : 4
  for (const frame of tag.frames.slice()) {
    if (frame.frameId.toString() !== 'GEOB') continue
    const description = descriptionAndPayload(frame)?.description
    if (description === MARKERS2 || description === MARKERS_V1) tag.removeFrame(frame)
  }
  tag.addFrame(markers2Frame(payload))
  dropBrokenUfids(tag)
  keepGenreParentheses(tag)
}

export function setSeratoMarkers(file: string, payload: Uint8Array): void {
  const ext = extname(file).toLowerCase()
  const f = TagFile.createFromPath(file)
  try {
    if (ID3_EXTENSIONS.has(ext)) setId3Markers(f, ext, payload)
    else if (ext === '.flac')
      (f.getTag(TagTypes.Xiph, true) as XiphComment).setFieldAsStrings(
        FLAC_MARKERS2,
        seratoArmored(payload),
      )
    else if (ext === '.m4a' || ext === '.mp4') {
      const apple = f.tag as Mpeg4AppleTag
      apple.setItunesStrings(SERATO_MEAN, 'markersv2', seratoArmored(payload))
      apple.setItunesStrings(SERATO_MEAN, 'markers')
    } else throw new Error(`no Serato tag for ${ext}`)
    f.save()
  } finally {
    f.dispose()
  }
}
