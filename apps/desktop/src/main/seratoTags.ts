import { extname } from 'node:path'
import {
  type Id3v2Frame,
  type Id3v2Tag,
  type Mpeg4AppleTag,
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
} from '../shared/seratoMarkers'
import { geobParts } from './tags'

const DEFAULT_SAMPLE_RATE = 44100
const ID3_EXTENSIONS = new Set(['.mp3', '.aiff', '.aif', '.wav'])

function descriptionAndPayload(frame: Id3v2Frame): ReturnType<typeof geobParts> {
  try {
    return geobParts(frame.render(4).toByteArray())
  } catch {
    return null
  }
}

function id3Markers(f: TagFile): SeratoMarkers | null {
  const tag = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
  for (const frame of tag?.frames ?? []) {
    if (frame.frameId.toString() !== 'GEOB') continue
    const parts = descriptionAndPayload(frame)
    if (parts?.description === 'Serato Markers2') return markersFromGeob(parts.payload)
  }
  return null
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
  const value = xiph?.getField('SERATO_MARKERS_V2')?.[0]
  return value ? markersFromArmored(value) : null
}

function m4aMarkers(f: TagFile): SeratoMarkers | null {
  const value = (f.tag as Mpeg4AppleTag).getItunesStrings('com.serato.dj', 'markersv2')[0]
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
