import { extname } from 'node:path'
import {
  ByteVector,
  Id3v2AttachmentFrame,
  type Id3v2Frame,
  type Id3v2Tag,
  Id3v2UserTextInformationFrame,
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
  retimedSeratoBeatGrid,
  retimedSeratoPayload,
  retimedSeratoTempoMap,
  type SeratoMarkers,
  type SeratoTempoMap,
  seratoArmored,
  seratoGeobBody,
  seratoObjectArmored,
  seratoObjectUnarmored,
  seratoPayloadOf,
  seratoV1Agrees,
  seratoV1CueTimes,
  seratoV1CueTimesArmored,
  type SeratoV1Cues,
  seratoV1Cues,
  seratoV1CuesArmored,
  withSeratoCues,
} from '../shared/seratoMarkers'
import { seratoLeadOfFile } from './seratoClock'
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

// The beat grid in each container's own field: the Tempo Map Serato 5 writes and the older
// BeatGrid. Both sit on the cues' clock, so a copy moves them by the same amount.
const GRIDS = [
  {
    key: 'tempoMap',
    geob: 'Serato Tempo Map',
    vorbis: 'SERATO_TEMPO_MAP',
    atom: 'tempomap',
    retimed: retimedSeratoTempoMap,
  },
  {
    key: 'beatGrid',
    geob: 'Serato BeatGrid',
    vorbis: 'SERATO_BEATGRID',
    atom: 'beatgrid',
    retimed: retimedSeratoBeatGrid,
  },
] as const

type SeratoGrids = Record<(typeof GRIDS)[number]['key'], Uint8Array | null>

function rawGrid(f: TagFile, ext: string, grid: (typeof GRIDS)[number]): Uint8Array | null {
  if (ID3_EXTENSIONS.has(ext)) return id3Geob(f, grid.geob)
  const value =
    ext === '.flac'
      ? (f.getTag(TagTypes.Xiph, false) as XiphComment | null)?.getField(grid.vorbis)?.[0]
      : ext === '.m4a' || ext === '.mp4'
        ? (f.tag as Mpeg4AppleTag).getItunesStrings(SERATO_MEAN, grid.atom)[0]
        : undefined
  return value ? seratoObjectUnarmored(value, grid.geob) : null
}

function rawGrids(f: TagFile, ext: string): SeratoGrids {
  return {
    tempoMap: rawGrid(f, ext, GRIDS[0]),
    beatGrid: rawGrid(f, ext, GRIDS[1]),
  }
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

function oldBlockDisagrees(f: TagFile, ext: string, markers: SeratoMarkers | null): boolean {
  if (ext === '.mp3') {
    const block = id3Geob(f, MARKERS_V1)
    return block !== null && !seratoV1Agrees(seratoV1CueTimes(block), markers)
  }
  if (ext === '.m4a' || ext === '.mp4') {
    const value = (f.tag as Mpeg4AppleTag).getItunesStrings(SERATO_MEAN, 'markers')[0]
    return value !== undefined && !seratoV1Agrees(seratoV1CueTimesArmored(value), markers)
  }
  return false
}

function oldBlockOf(f: TagFile, ext: string): SeratoV1Cues | 'unreadable' | null {
  if (ext === '.mp3') {
    const block = id3Geob(f, MARKERS_V1)
    return block ? (seratoV1Cues(block) ?? 'unreadable') : null
  }
  if (ext === '.m4a' || ext === '.mp4') {
    const value = (f.tag as Mpeg4AppleTag).getItunesStrings(SERATO_MEAN, 'markers')[0]
    return value !== undefined ? (seratoV1CuesArmored(value) ?? 'unreadable') : null
  }
  return null
}

export function readSeratoTrack(file: string): {
  payload: Uint8Array | null
  markers: SeratoMarkers | null
  oldBlockDisagrees: boolean
  oldBlock: SeratoV1Cues | 'unreadable' | null
  tempoMap: SeratoTempoMap | null
  grids: SeratoGrids
  durationMs: number
  sampleRate: number
  trackNo: number
} | null {
  const ext = extname(file).toLowerCase()
  const read = readerFor(ext)
  const readTempo = tempoReaderFor(ext)
  try {
    const f = TagFile.createFromPath(file)
    try {
      const source = markersSource(f, ext)
      const markers = read ? read(f) : null
      return {
        payload: source ? seratoPayloadOf(source) : null,
        markers,
        oldBlockDisagrees: oldBlockDisagrees(f, ext, markers),
        oldBlock: oldBlockOf(f, ext),
        tempoMap: readTempo ? readTempo(f) : null,
        grids: rawGrids(f, ext),
        durationMs: f.properties?.durationMilliseconds ?? 0,
        sampleRate: f.properties?.audioSampleRate || DEFAULT_SAMPLE_RATE,
        trackNo: f.tag.track,
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

function seratoFrame(description: string, body: Uint8Array): Id3v2AttachmentFrame {
  const picture = Picture.fromFullData(
    ByteVector.fromByteArray(body),
    PictureType.NotAPicture,
    'application/octet-stream',
    description,
  )
  picture.filename = ''
  const frame = Id3v2AttachmentFrame.fromPicture(picture)
  frame.textEncoding = StringType.Latin1
  return frame
}

function setId3Markers(f: TagFile, payload: Uint8Array): void {
  const fresh = (f.tagTypesOnDisk & TagTypes.Id3v2) === 0
  const tag = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
  if (fresh) tag.version = 3
  for (const frame of tag.frames.slice()) {
    if (frame.frameId.toString() !== 'GEOB') continue
    const description = descriptionAndPayload(frame)?.description
    if (description === MARKERS2 || description === MARKERS_V1) tag.removeFrame(frame)
  }
  tag.addFrame(seratoFrame(MARKERS2, seratoGeobBody(payload)))
  dropBrokenUfids(tag)
  keepGenreParentheses(tag)
}

function applyMarkers(f: TagFile, ext: string, payload: Uint8Array): void {
  if (ID3_EXTENSIONS.has(ext)) setId3Markers(f, payload)
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
}

function applyGrid(f: TagFile, ext: string, grid: (typeof GRIDS)[number], data: Uint8Array): void {
  if (ID3_EXTENSIONS.has(ext)) {
    const fresh = (f.tagTypesOnDisk & TagTypes.Id3v2) === 0
    const tag = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
    if (fresh) tag.version = 3
    for (const frame of tag.frames.slice())
      if (
        frame.frameId.toString() === 'GEOB' &&
        descriptionAndPayload(frame)?.description === grid.geob
      )
        tag.removeFrame(frame)
    tag.addFrame(seratoFrame(grid.geob, data))
    dropBrokenUfids(tag)
    keepGenreParentheses(tag)
  } else if (ext === '.flac')
    (f.getTag(TagTypes.Xiph, true) as XiphComment).setFieldAsStrings(
      grid.vorbis,
      seratoObjectArmored(grid.geob, data),
    )
  else if (ext === '.m4a' || ext === '.mp4')
    (f.tag as Mpeg4AppleTag).setItunesStrings(
      SERATO_MEAN,
      grid.atom,
      seratoObjectArmored(grid.geob, data),
    )
}

function markersTag(ext: string): TagTypes {
  if (ID3_EXTENSIONS.has(ext)) return TagTypes.Id3v2
  if (ext === '.flac') return TagTypes.Xiph
  return TagTypes.Apple
}

function saveKeeping(f: TagFile, keep: number): void {
  f.removeTags(f.tagTypes & ~keep)
  f.save()
}

export function setSeratoMarkers(file: string, payload: Uint8Array): void {
  const ext = extname(file).toLowerCase()
  const f = TagFile.createFromPath(file)
  try {
    const keep = f.tagTypesOnDisk | markersTag(ext)
    applyMarkers(f, ext, payload)
    saveKeeping(f, keep)
  } finally {
    f.dispose()
  }
}

function isSeratoAnalysis(description: string | undefined): boolean {
  return description?.startsWith('Serato ') === true && description !== MARKERS2
}

function dropSeratoAnalysis(f: TagFile, ext: string): boolean {
  if (ext === '.flac') {
    const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment | null
    const fields = (xiph?.fieldNames ?? []).filter(
      (name) => /^serato_/i.test(name) && name.toUpperCase() !== FLAC_MARKERS2,
    )
    for (const name of fields) xiph?.removeField(name)
    return fields.length > 0
  }
  if (!ID3_EXTENSIONS.has(ext)) return false
  const tag = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
  const frames = (tag?.frames ?? []).filter((frame) =>
    frame instanceof Id3v2UserTextInformationFrame
      ? /^serato_/i.test(frame.description)
      : frame.frameId.toString() === 'GEOB' &&
        isSeratoAnalysis(descriptionAndPayload(frame)?.description),
  )
  for (const frame of frames) tag?.removeFrame(frame)
  return frames.length > 0
}

function dropSeratoCues(f: TagFile, ext: string): boolean {
  if (ext === '.m4a' || ext === '.mp4') {
    const apple = f.tag as Mpeg4AppleTag
    const held = ['markersv2', 'markers'].filter(
      (name) => apple.getItunesStrings(SERATO_MEAN, name).length > 0,
    )
    for (const name of held) apple.setItunesStrings(SERATO_MEAN, name)
    return held.length > 0
  }
  if (ext === '.flac') {
    const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment | null
    const held = (xiph?.getField(FLAC_MARKERS2) ?? []).length > 0
    if (held) xiph?.removeField(FLAC_MARKERS2)
    return held
  }
  const tag = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
  const frames = (tag?.frames ?? []).filter((frame) => {
    if (frame.frameId.toString() !== 'GEOB') return false
    const description = descriptionAndPayload(frame)?.description
    return description === MARKERS2 || description === MARKERS_V1
  })
  for (const frame of frames) tag?.removeFrame(frame)
  return frames.length > 0
}

function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  return a !== null && a.length === b.length && a.every((byte, at) => byte === b[at])
}

async function measuredLeads(
  source: string,
  from: { sampleRate: number },
  dest: string,
  to: { sampleRate: number },
  forgiving: boolean,
): Promise<{ source: number; dest: number } | null> {
  try {
    return {
      source: await seratoLeadOfFile(source, from.sampleRate),
      dest: await seratoLeadOfFile(dest, to.sampleRate),
    }
  } catch (err) {
    if (forgiving) return null
    throw err
  }
}

// In an MP3 or M4A Serato shows the old block's cues and ignores Markers2 (measured 03/11),
// so a replacement carries those when the old block disagrees or stands alone: the cues are
// rebuilt from it, with the Markers2 name on the same pad and the Markers2 loops kept. An old
// block Surco cannot read, or one with a loop it has never measured there, cannot be carried
// whole, and Serato must not be pointed at a file that lost what it showed.
function payloadSeratoShows(
  from: NonNullable<ReturnType<typeof readSeratoTrack>>,
): Uint8Array | null {
  const old = from.oldBlock
  if (!old || (from.payload && !from.oldBlockDisagrees)) return from.payload
  if (old === 'unreadable' || old.loops) throw new Error('cannot carry the old Serato cue block')
  const named = from.markers?.cues ?? []
  return withSeratoCues(
    from.payload,
    old.cues.map((cue) => ({
      ...cue,
      name: named.find((c) => c.index === cue.index)?.name ?? '',
    })),
  )
}

// A file Surco cannot read may hold anything, so it counts as holding Serato data.
function holdsSerato(track: ReturnType<typeof readSeratoTrack>): boolean {
  return (
    !track ||
    !!(
      track.payload ||
      track.markers ||
      track.oldBlock ||
      track.grids.tempoMap ||
      track.grids.beatGrid
    )
  )
}

// What an ordinary conversion's caller must log: the carry runs in a worker with no logger,
// and cues left out without a line in the log are cues lost with no trace.
export type SeratoCarryOutcome = 'clock-unmeasured' | null

// shiftMs is for a replacement master where the same audio sits later (positive) or earlier
// than in the source; it moves the cues but not the trim cut, which is a position in the source.
export async function carrySeratoCues(
  source: string,
  dest: string,
  {
    trimMs,
    carry,
    strip,
    shiftMs,
    fallback,
  }: {
    trimMs: number
    carry: boolean
    strip: boolean
    shiftMs: number
    fallback?: { source: string; trimMs: number }
  },
): Promise<SeratoCarryOutcome> {
  const ext = extname(dest).toLowerCase()
  const from = carry ? readSeratoTrack(source) : null
  // An unreadable source is not one without cues: a replacement's caller must hear it,
  // because a copy without the cues must not have Serato pointed at it. An ordinary
  // conversion carries on, so the stale analysis is still stripped from its output.
  if (carry && !from && fallback) throw new Error(`cannot read ${source}`)
  const shown = from && fallback ? payloadSeratoShows(from) : (from?.payload ?? null)
  // Asking for no Serato data on the new file leaves the replaced one as it was: Serato still
  // holds its cues and grid there, so its caller must keep Serato on it, not on this copy.
  const heldBack = !carry && fallback !== undefined && holdsSerato(readSeratoTrack(source))
  // A readable source with no cues and no grid has nothing to carry: the file converted
  // keeps its own, as an ordinary conversion would carry them. A grid alone is still the
  // DJ's work on the replaced file, so it is carried and the download's cues are not.
  if (from && !shown && !from.markers && !from.grids.tempoMap && !from.grids.beatGrid && fallback)
    return carrySeratoCues(fallback.source, dest, {
      trimMs: fallback.trimMs,
      carry,
      strip,
      shiftMs: 0,
    })
  const to = readSeratoTrack(dest)
  if (!to && heldBack) throw new Error(`Serato data of ${source} not carried`)
  if (!to) return null
  const timed = shown || from?.grids.tempoMap || from?.grids.beatGrid
  // Without Serato's clock nothing can be placed. A replacement must hear it, like an
  // unreadable source; an ordinary conversion carries nothing and still strips.
  const leads = from && timed ? await measuredLeads(source, from, dest, to, !fallback) : null
  const carried = leads ? from : null
  const sourceLead = leads?.source ?? 0
  const moveMs = leads ? leads.dest - sourceLead - trimMs + shiftMs : 0
  const payload =
    carried && shown
      ? retimedSeratoPayload(shown, moveMs, trimMs > 0 ? sourceLead + trimMs : 0)
      : null
  const changed = payload && !sameBytes(to.payload, payload) ? payload : null
  const fresh = carried?.oldBlockDisagrees && !fallback ? null : changed
  // The grid is not analysis to strip: a DJ may have set it by hand. It moves with the
  // cues, by the same amount, and only a shape Surco can read whole is copied.
  // A replacement retires the file that holds the grid, so one it cannot move is lost, and
  // Serato must not be pointed at its copy; an ordinary conversion keeps its source.
  const grids = GRIDS.flatMap((grid) => {
    const raw = carried?.grids[grid.key]
    const data = raw ? grid.retimed(raw, moveMs) : null
    if (raw && !data && fallback) throw new Error(`cannot move the ${grid.geob} of ${source}`)
    return data ? [{ grid, data }] : []
  })
  const f = TagFile.createFromPath(dest)
  try {
    const keep = f.tagTypesOnDisk | (fresh || grids.length > 0 ? markersTag(ext) : 0)
    const stripped = strip && dropSeratoAnalysis(f, ext)
    // On a replacement whose file had a grid but no cues, cues the download brought along
    // were never the DJ's in Serato.
    const foreign = fallback !== undefined && !payload
    const dropped = ((changed !== null && fresh === null) || foreign) && dropSeratoCues(f, ext)
    if (fresh) applyMarkers(f, ext, fresh)
    const regridded = grids.filter(
      ({ grid, data }) => stripped || !sameBytes(to.grids[grid.key], data),
    )
    for (const { grid, data } of regridded) applyGrid(f, ext, grid, data)
    if (fresh || stripped || dropped || regridded.length > 0) saveKeeping(f, keep)
  } finally {
    f.dispose()
  }
  if (heldBack) throw new Error(`Serato data of ${source} not carried`)
  return leads || !timed ? null : 'clock-unmeasured'
}
