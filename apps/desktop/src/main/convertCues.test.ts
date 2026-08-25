import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { type Id3v2Tag, File as TagFile, TagTypes, type XiphComment } from 'node-taglib-sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

let traktorNmlPath = ''
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath }) }))

import type { TrackMetadata } from '../shared/types'
import { decodeBase91, encodeBase91 } from './base91'
import { convertAudio, toNmlLocation } from './ffmpeg'
import { beginNmlBatch, endNmlBatch } from './nmlBatch'
import { readCueTree } from './tags'
import { buildTraktorTree, readTraktorCueStart, traktorCue } from './traktor4Fixture'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-cues-'))
const src = join(dir, 'in.aiff')

const meta: TrackMetadata = {
  title: 'Till I Come',
  artist: 'ATB',
  album: 'Movin Melodies',
  albumArtist: 'ATB',
  year: '1999',
  genre: 'Trance',
  grouping: '',
  comment: '',
  trackNumber: '2',
  discNumber: '',
  bpm: '138',
  key: '9A',
  publisher: 'Kontor',
  catalogNumber: 'KON-123',
  remixArtist: '',
}

// A raw ID3v2.3 tag carrying a single GEOB "TRAKTOR4" frame — exactly how Traktor
// stores its cue points/beatgrid on disk. Written as raw bytes (not via TagLib's
// UnknownFrame API, whose frames don't round-trip cleanly) so copyCueFrames clones
// the real on-disk shape a converted file would actually carry.
function id3WithCue(): Buffer {
  const frame = (id: string, data: Buffer) => {
    const head = Buffer.alloc(10)
    head.write(id, 0, 'latin1')
    head.writeUInt32BE(data.length, 4)
    return Buffer.concat([head, data])
  }
  const geob = frame(
    'GEOB',
    Buffer.concat([
      Buffer.from([0]),
      Buffer.from('application/octet-stream', 'latin1'),
      Buffer.from([0, 0]),
      Buffer.from('TRAKTOR4', 'latin1'),
      Buffer.from([0]),
      Buffer.from('TRAKTORCUEBLOB', 'latin1'),
    ]),
  )
  const syncsafe = (n: number) =>
    Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(geob.length), geob])
}

// Appends an AIFF 'ID3 ' chunk holding the raw cue tag, fixing up the FORM size.
function injectAiffCue(path: string): void {
  const base = readFileSync(path)
  const id3 = id3WithCue()
  const body = id3.length % 2 ? Buffer.concat([id3, Buffer.from([0])]) : id3
  const size = Buffer.alloc(4)
  size.writeUInt32BE(id3.length)
  const out = Buffer.concat([base, Buffer.from('ID3 '), size, body])
  out.writeUInt32BE(out.length - 8, 4)
  writeFileSync(path, out)
}

function hasCue(file: string): boolean {
  const f = TagFile.createFromPath(file)
  try {
    const tag = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    return (tag?.frames ?? []).some((fr) => fr.frameId.toString() === 'GEOB')
  } finally {
    f.dispose()
  }
}

function hasPopm(file: string): boolean {
  const f = TagFile.createFromPath(file)
  try {
    const tag = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    return (tag?.frames ?? []).some((fr) => fr.frameId.toString() === 'POPM')
  } finally {
    f.dispose()
  }
}

const cover = join(dir, 'cover.jpg')

beforeAll(() => {
  // A real, decodable integer-PCM AIFF so convertAudio's probe/re-encode runs for
  // real, with a raw Traktor GEOB cue frame written into its ID3 chunk.
  execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', src])
  injectAiffCue(src)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=16x16:d=1',
    '-frames:v',
    '1',
    cover,
  ])
})

describe('convertAudio cue preservation', () => {
  // The reported bug: converting a cued track to another format is a plain
  // re-encode (no loudness pass), and ffmpeg rebuilds the tag dropping Traktor's
  // GEOB cue/beatgrid frame. The frame was only restored on the normalize path,
  // so a straight format change silently lost every cue.
  it('keeps the source GEOB cue frame when re-encoding to an ID3 target without normalizing', async () => {
    expect(hasCue(src)).toBe(true)
    const out = join(dir, 'out.mp3')
    await convertAudio(src, out, 'mp3', meta)
    expect(hasCue(out)).toBe(true)
  })

  // A rated track exercises the encode path's TagLib pass (POPM has no ffmpeg
  // flag) on top of the cue carry-over — both must land in the output, whatever
  // shape the tag passes take.
  it('keeps both the cue frame and the rating when re-encoding a rated track', async () => {
    const out = join(dir, 'out-rated.mp3')
    await convertAudio(src, out, 'mp3', { ...meta, rating: '4' })
    expect(hasCue(out)).toBe(true)
    const f = TagFile.createFromPath(out)
    try {
      const tag = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
      const popm = (tag?.frames ?? []).filter((fr) => fr.frameId.toString() === 'POPM')
      expect(popm.length).toBeGreaterThan(0)
    } finally {
      f.dispose()
    }
  })

  // "Clear metadata" then convert: clearExtras forces the empty rating to wipe the
  // POPM the source carried, and now the Traktor cue blob too — "clear everything"
  // means everything, cues included.
  it('wipes the rating and the cue frame on a cleared convert', async () => {
    // A fresh cued source in its own dir: TagLib holds files open across a shared
    // temp dir, so this test mints its own to stay independent of the others.
    const own = mkdtempSync(join(tmpdir(), 'surco-clear-'))
    const cued = join(own, 'in.aiff')
    execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', cued])
    injectAiffCue(cued)

    // First give the source a real rating in an mp3, then clear-convert it.
    const rated = join(own, 'rated-src.mp3')
    await convertAudio(cued, rated, 'mp3', { ...meta, rating: '4' })
    expect(hasPopm(rated)).toBe(true)

    const out = join(own, 'out-cleared.mp3')
    await convertAudio(
      rated,
      out,
      'mp3',
      { ...meta, rating: '' },
      undefined, // coverPath
      undefined, // normalize
      true, // removeCover
      undefined, // quality
      undefined, // forceReencode
      undefined, // onChild
      undefined, // onTmp
      undefined, // finderCovers
      undefined, // declick
      undefined, // trim
      true, // clearExtras
    )

    expect(hasCue(out)).toBe(false)
    expect(hasPopm(out)).toBe(false)
  })

  // djotas's FLAC library, end to end: the TRAKTOR4 comment survives ffmpeg on its
  // own, so before this the cues came out the far side still measured from the
  // pre-trim start — every marker sitting late by the whole cut. Now the same
  // parser MP3 uses re-anchors them through the armoring, hotcues by the cut and
  // the grid marker by its phase.
  it('re-anchors the FLAC cue comment through a trimming convert', async () => {
    const own = mkdtempSync(join(tmpdir(), 'surco-flacconv-'))
    const cued = join(own, 'in.flac')
    const tree = buildTraktorTree([
      traktorCue('AutoGrid', 4, 143.38, 0),
      traktorCue('Drop', 0, 79672.64, 1),
    ])
    execFileSync(FF, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      '-metadata',
      `TRAKTOR4=${encodeBase91(tree)}`,
      cued,
    ])

    const out = join(own, 'out.flac')
    await convertAudio(
      cued,
      out,
      'flac',
      { ...meta, bpm: '138.30' },
      undefined, // coverPath
      undefined, // normalize
      false, // removeCover
      undefined, // quality
      undefined, // forceReencode
      undefined, // onChild
      undefined, // onTmp
      undefined, // finderCovers
      undefined, // declick
      { startSec: 1.3 }, // trim
    )

    const f = TagFile.createFromPath(out)
    const armored = (f.getTag(TagTypes.Xiph, false) as XiphComment | null)?.getField(
      'TRAKTOR4',
    )?.[0]
    f.dispose()
    expect(armored).toBeDefined()
    expect(readTraktorCueStart(decodeBase91(armored as string), 1)).toBeCloseTo(78372.64)
  })

  // The library move users actually make: an AIFF crate with cues converted to FLAC. The
  // output extension picks the cue path, so .flac routes to shiftFlacCues — which only
  // re-anchors a TRAKTOR4 comment that rode the encode by itself. Coming from AIFF the cues
  // were in an ID3 GEOB that ffmpeg does not translate into a Vorbis comment, so there is
  // nothing to shift and they are simply gone. Crossing tag families has to carry them over.
  it('carries the cues over when converting a cued AIFF to FLAC', async () => {
    const own = mkdtempSync(join(tmpdir(), 'surco-aiff2flac-'))
    const cued = join(own, 'in.aiff')
    execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', cued])
    injectAiffCue(cued)
    expect(hasCue(cued)).toBe(true)

    const out = join(own, 'out.flac')
    await convertAudio(cued, out, 'flac', meta)

    const f = TagFile.createFromPath(out)
    const armored = (f.getTag(TagTypes.Xiph, false) as XiphComment | null)?.getField(
      'TRAKTOR4',
    )?.[0]
    f.dispose()
    expect(armored).toBeDefined()
  })

  // The re-encode path folds the cue carry-over into the same writeTags call as the
  // rating (cueSource: input, see ffmpeg.ts), so a clearExtras re-encode must not let
  // that carry-over reinject the very cues clearExtras just wiped — converting a cued
  // AIFF to a different ID3 format (forcing the encode path, not the in-place stream
  // copy) with clearExtras must drop the cue for good.
  it('does not reinject the source cue frame on a cleared re-encode to a different format', async () => {
    expect(hasCue(src)).toBe(true)
    const out = join(dir, 'out-cleared-reencode.mp3')
    await convertAudio(
      src,
      out,
      'mp3',
      meta,
      undefined, // coverPath
      undefined, // normalize
      false, // removeCover
      undefined, // quality
      undefined, // forceReencode
      undefined, // onChild
      undefined, // onTmp
      undefined, // finderCovers
      undefined, // declick
      undefined, // trim
      true, // clearExtras
    )
    expect(hasCue(out)).toBe(false)
  })

  // El NML se actualiza con lo que la conversión dejó en el fichero de salida, así
  // que el patch se registra después de escribir los cues, no antes. Sin ruta de
  // colección configurada no se registra nada: la feature está apagada.
  it('records a collection patch for a converted track when a collection is configured', async () => {
    traktorNmlPath = '/Users/dj/collection.nml'
    beginNmlBatch()
    const out = join(dir, 'out-nml.flac')
    await convertAudio(src, out, 'flac', { ...meta, bpm: '138.30' })

    const patches = endNmlBatch()

    expect(patches).toHaveLength(1)
    expect(patches[0].file).toBe('in.aiff')
    expect(patches[0].newFile).toBe('out-nml.flac')
    expect(patches[0].bpm).toBeCloseTo(138.3)
    expect(patches[0].cueTree).toBeDefined()
  })

  // meta.bpm es un string: una pista sin BPM tiene que llegar como undefined, nunca
  // como NaN. Un NaN parece un valor y se cuela hasta el filtro de cuesToXml, donde
  // descarta el ancla de rejilla sin decir nada — el fallo silencioso que esta guarda
  // existe para evitar.
  it('leaves the bpm undefined when the track has none', async () => {
    traktorNmlPath = '/Users/dj/collection.nml'
    beginNmlBatch()
    await convertAudio(src, join(dir, 'out-nobpm.flac'), 'flac', { ...meta, bpm: '' })

    expect(endNmlBatch()[0].bpm).toBeUndefined()
  })

  // Con la ruta vacía (por defecto) no se toca nada: ni lecturas de disco extra ni
  // patches acumulados que nadie va a volcar.
  it('records nothing when no collection path is configured', async () => {
    traktorNmlPath = ''
    beginNmlBatch()
    await convertAudio(src, join(dir, 'out-off.flac'), 'flac', meta)

    expect(endNmlBatch()).toEqual([])
  })

  // Hallazgo crítico 1: el caso por defecto (overwriteOriginal: false) manda la
  // salida a outputDir, una carpeta distinta de la del origen. volume/dir salen
  // del INPUT; newFile, del basename del OUTPUT — si newFile se escribiera igual
  // aquí, la ENTRY quedaría repuntada a un FICHERO QUE NO EXISTE en la carpeta del
  // origen (mismo volume/dir, nombre del output) y Traktor la marcaría perdida,
  // con su historial de playlists y reproducciones. Cuando el output cae en otra
  // carpeta, newFile debe quedar undefined: sólo los cues se actualizan in place,
  // sobre la ENTRY que sigue apuntando al fichero que de verdad está ahí.
  it('does not repoint the entry when the output lands in a different directory than the input', async () => {
    traktorNmlPath = '/Users/dj/collection.nml'
    beginNmlBatch()
    const otherDir = mkdtempSync(join(tmpdir(), 'surco-cues-outdir-'))
    const out = join(otherDir, 'out-elsewhere.flac')
    await convertAudio(src, out, 'flac', { ...meta, bpm: '138.30' })

    const patches = endNmlBatch()

    expect(patches).toHaveLength(1)
    expect(patches[0].file).toBe('in.aiff')
    expect(patches[0].newFile).toBeUndefined()
    expect(patches[0].cueTree).toBeDefined()
  })

  // Hallazgo importante 3: clearCoverArt existe en NmlPatch y está probado a nivel
  // de applyPatches, pero nada en producción lo fijaba nunca — la mitad del
  // problema que motiva la feature (Traktor sigue mostrando la carátula vieja
  // cacheada por COVERARTID) seguía sin arreglarse. Cuando la conversión escribió
  // una carátula nueva en el fichero (coverPath presente y removeCover no activo,
  // la misma señal que ya usa embedCover/finderCovers arriba), el patch debe pedir
  // que Traktor la relea en vez de servir la que tiene en caché.
  it('sets clearCoverArt on the patch when the conversion wrote artwork', async () => {
    traktorNmlPath = '/Users/dj/collection.nml'
    beginNmlBatch()
    const out = join(dir, 'out-cover.flac')
    await convertAudio(src, out, 'flac', meta, cover)

    const patches = endNmlBatch()

    expect(patches).toHaveLength(1)
    expect(patches[0].clearCoverArt).toBe(true)
  })

  // La otra cara: sin carátula que escribir (coverPath ausente), el patch no debe
  // pedir un borrado que no corresponde a nada que la conversión haya cambiado.
  it('does not set clearCoverArt when the conversion wrote no artwork', async () => {
    traktorNmlPath = '/Users/dj/collection.nml'
    beginNmlBatch()
    const out = join(dir, 'out-nocover.flac')
    await convertAudio(src, out, 'flac', meta)

    const patches = endNmlBatch()

    expect(patches[0].clearCoverArt).toBeFalsy()
  })
})

describe('toNmlLocation', () => {
  // Traktor no guarda la ruta del sistema: parte el volumen, la carpeta en su
  // sintaxis /: y el fichero. Una traducción mal hecha no falla — no casa ninguna
  // ENTRY, que es el fallo silencioso que más cuesta diagnosticar.
  it('splits a volume path into the collection s own shape', () => {
    expect(toNmlLocation('/Volumes/Musica_Sono/MUSICA/track.aiff')).toEqual({
      volume: 'Musica_Sono',
      dir: '/:MUSICA/:',
      file: 'track.aiff',
    })
  })

  it('keeps nested folders in order', () => {
    expect(toNmlLocation('/Volumes/X/A/B/t.mp3').dir).toBe('/:A/:B/:')
  })
})

// WAV never reached a cue branch. convertAudio's cascade sends it to its own writeTags
// pass (the one that fixes RIFF/iTunes tags) and that pass ran without a cueSource, so
// no carry-over happened; ID3_IN_PLACE covers only .mp3/.aiff and the FLAC arm is an
// else. A DJ converting a cued crate to WAV got "converted" and a file with no beatgrid
// — the loss Traktor shows as a track with no grid at all.
describe('cues survive a conversion to WAV', () => {
  it('carries the Traktor cue tree over to wav', async () => {
    const own = mkdtempSync(join(tmpdir(), 'surco-cue-wav-'))
    const cued = join(own, 'in.aiff')
    execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', cued])
    injectAiffCue(cued)
    expect(readCueTree(cued)).not.toBeNull()

    const out = join(own, 'out.wav')
    await convertAudio(cued, out, 'wav', meta)

    expect(readCueTree(out)).not.toBeNull()
  })

  // ALAC is the deliberate exception, pinned here so the asymmetry is a decision on
  // record rather than a gap someone "fixes" later. Traktor's tree is an ID3 structure
  // and an MP4 has no ID3 to put it in — writeTags returns at its iTunes-atom branch
  // precisely because forcing one in would corrupt the file. Armoring the tree into a
  // freeform atom (the trick FLAC uses) would write bytes no program reads back, since
  // Traktor does not read ALAC at all: it is offered for Apple Music, not for DJing.
  // What must hold is that the conversion still succeeds and stays a valid MP4.
  it('leaves an alac conversion without cues, and still valid', async () => {
    const own = mkdtempSync(join(tmpdir(), 'surco-cue-alac-'))
    const cued = join(own, 'in.aiff')
    execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', cued])
    injectAiffCue(cued)

    const out = join(own, 'out.m4a')
    await convertAudio(cued, out, 'alac', meta)

    expect(readCueTree(out)).toBeNull()
    // The tags the container CAN hold still land, so "no cues" never means "no pass".
    const f = TagFile.createFromPath(out)
    try {
      expect(f.tag.title).toBe(meta.title)
    } finally {
      f.dispose()
    }
  })
})
