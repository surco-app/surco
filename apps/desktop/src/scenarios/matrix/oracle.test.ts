import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  Id3v2FrameIdentifier,
  Id3v2FrameIdentifiers,
  type Id3v2Tag,
  Id3v2TextInformationFrame,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../electronFake')).electronFake())

import { prependFlacId3 } from '../../main/flacFinderCover'
import { writeTags } from '../../main/tags'
import { emptyMetadata } from '../../shared/metadata'
import type { OutputFormat } from '../../shared/types'
import { coverJpg, scenarioDir } from '../fixtures'
import { CELLS, type Cell } from './cells'
import {
  fileInvariants,
  markerLagMs,
  originalBroken,
  pcmSha1,
  rekordboxTimelineMs,
  traktorCalibrationMs,
} from './oracle'
import { makeSource, type SourceTrack, TRICKY, type TrickyTags } from './sources'

const FF = ffmpegStatic as unknown as string

const ENCODE: Record<OutputFormat, { ext: string; args: string[] }> = {
  aiff: { ext: '.aiff', args: ['-c:a', 'pcm_s16be'] },
  wav: { ext: '.wav', args: ['-c:a', 'pcm_s16le'] },
  flac: { ext: '.flac', args: ['-c:a', 'flac', '-sample_fmt', 's16'] },
  alac: { ext: '.m4a', args: ['-c:a', 'alac', '-sample_fmt', 's16p'] },
  mp3: { ext: '.mp3', args: ['-c:a', 'libmp3lame', '-b:a', '320k'] },
}

function cellOf(id: string): Cell {
  const cell = CELLS.find((c) => c.id === id)
  if (!cell) throw new Error(`no cell ${id}`)
  return cell
}

function sha1(path: string): string {
  return createHash('sha1').update(readFileSync(path)).digest('hex')
}

const padded = (tags: TrickyTags): TrickyTags =>
  tags.trackNumber === '3/12' ? { ...tags, trackNumber: '03/12' } : tags

function vorbisFields(tags: TrickyTags): [string, string][] {
  const [track, trackTotal] = tags.trackNumber.split('/')
  const [disc, discTotal] = tags.discNumber.split('/')
  return [
    ['TITLE', tags.title],
    ['ARTIST', tags.artist],
    ['ALBUM', tags.album],
    ['GENRE', tags.genre],
    ['GROUPING', tags.grouping],
    ['TRACKNUMBER', track],
    ['TRACKTOTAL', trackTotal],
    ['DISCNUMBER', disc],
    ['DISCTOTAL', discTotal],
    ['BPM', tags.bpm],
    ['INITIALKEY', tags.key],
    ['LABEL', tags.publisher],
    ['PUBLISHER', tags.publisher],
    ['CATALOGNUMBER', tags.catalogNumber],
    ['COMMENT', tags.comment],
  ]
}

function setVorbis(path: string, fields: [string, string | undefined][]): void {
  const f = TagFile.createFromPath(path)
  try {
    const xiph = f.getTag(TagTypes.Xiph, true) as XiphComment
    for (const [key, value] of fields) {
      if (value) xiph.setFieldAsStrings(key, value)
      else xiph.removeField(key)
    }
    f.save()
  } finally {
    f.dispose()
  }
}

function encodeFlac(source: SourceTrack, path: string, cover: string | null): void {
  const picture = cover
    ? ['-i', cover, '-map', '1:v', '-c:v', 'copy', '-disposition:v', 'attached_pic']
    : []
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-i',
    source.path,
    ...picture,
    '-map',
    '0:a:0',
    '-map_metadata',
    '-1',
    ...ENCODE.flac.args,
    path,
  ])
  setVorbis(path, vorbisFields(padded(source.tags)))
}

function convertByHand(
  source: SourceTrack,
  target: OutputFormat,
  dir: string,
  name: string,
): { path: string; coverSha1: string } {
  const { ext, args } = ENCODE[target]
  const path = join(dir, `${name} Café Olé`.normalize('NFD') + ext)
  const cover = coverJpg(join(dir, `${name}.cover.jpg`))
  if (target === 'flac') {
    encodeFlac(source, path, cover)
    return { path, coverSha1: sha1(cover) }
  }
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-i',
    source.path,
    '-map',
    '0:a:0',
    '-map_metadata',
    '-1',
    ...args,
    path,
  ])
  writeTags(path, { ...emptyMetadata(), ...padded(source.tags) }, cover)
  return { path, coverSha1: sha1(cover) }
}

function editId3(path: string, edit: (id3: Id3v2Tag) => void, version = 3): void {
  const f = TagFile.createFromPath(path)
  try {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag
    edit(id3)
    setText(id3, Id3v2FrameIdentifiers.TCON, [TRICKY.genre])
    id3.version = version
    f.save()
  } finally {
    f.dispose()
  }
}

function setText(id3: Id3v2Tag, id: Id3v2FrameIdentifier, text: string[]): void {
  id3.removeFrames(id)
  const frame = Id3v2TextInformationFrame.fromIdentifier(id)
  frame.text = text
  id3.addFrame(frame)
}

const GRP1 = new Id3v2FrameIdentifier('GRP1', 'GRP1', 'GP1')

function dropGrp1(id3: Id3v2Tag): void {
  for (const fr of id3.frames.filter((frame) => frame.frameId.toString() === 'GRP1'))
    id3.removeFrame(fr)
}

function aiffSampleOffset(bytes: Buffer): number {
  const ssnd = bytes.indexOf(Buffer.from('SSND', 'latin1'))
  return ssnd + 16
}

describe('matrix file oracle', () => {
  const dir = scenarioDir('matrix-oracle')
  const flac = makeSource(dir, 'flac')
  const aiff = convertByHand(flac, 'aiff', dir, 'aiff')

  it('passes an AIFF made from a FLAC that kept the samples', () => {
    expect(pcmSha1(aiff.path)).toBe(pcmSha1(flac.path))
    expect(fileInvariants(cellOf('C-flac-aiff'), flac, aiff.path, aiff.coverSha1)).toEqual([])
  })

  it('passes an untouched FLAC as its own samples-kept FLAC output when tracks are not padded', () => {
    const unpadded = { ...cellOf('C-flac-flac'), settings: { zeroPadTrack: false } }
    expect(fileInvariants(unpadded, flac, flac.path, flac.coverSha1)).toEqual([])
  })

  it('expects the track number padded the way the cell has Surco write it', () => {
    const tracks = (cell: Cell, path: string) =>
      fileInvariants(cell, flac, path, null)
        .map((b) => b.detail)
        .filter((d) => d.startsWith('pista') || d.startsWith('ffprobe: track'))
    expect(tracks(cellOf('C-flac-aiff'), aiff.path)).toEqual([])
    const off = { ...cellOf('C-flac-aiff'), settings: { zeroPadTrack: false } }
    expect(tracks(off, aiff.path)).toContain("pista: TRCK '03/12', se esperaba '3/12'")
    const plain = convertByHand(flac, 'aiff', dir, 'plain')
    editId3(plain.path, (id3) => setText(id3, Id3v2FrameIdentifiers.TRCK, ['3/12']))
    expect(tracks(cellOf('C-flac-aiff'), plain.path)).toContain(
      "pista: TRCK '3/12', se esperaba '03/12'",
    )
    expect(tracks(off, plain.path)).toEqual([])
  })

  it.each(['wav', 'flac', 'alac', 'mp3'] as OutputFormat[])(
    'passes a %s written from a FLAC the way the pipeline writes it, so a red cell is never the oracle',
    (target) => {
      const out = convertByHand(flac, target, dir, `ok-${target}`)
      expect(fileInvariants(cellOf(`C-flac-${target}`), flac, out.path, out.coverSha1)).toEqual([])
    },
  )

  it('fails format for a FLAC that was only re-tagged under an .aiff name', () => {
    const fake = join(dir, 'retagged Café Olé.aiff'.normalize('NFD'))
    copyFileSync(flac.path, fake)
    const broken = fileInvariants(cellOf('C-flac-aiff'), flac, fake, flac.coverSha1)
    expect(broken.filter((b) => b.invariant === 'format').map((b) => b.detail)).toContain(
      "formato: contenedor 'flac', se esperaba 'aiff'",
    )
  })

  it('fails pcm when one sample changed', () => {
    const touched = join(dir, 'touched Café Olé.aiff'.normalize('NFD'))
    const bytes = readFileSync(aiff.path)
    const at = aiffSampleOffset(bytes) + 5 * 44100 * 4 + 1
    bytes[at] ^= 0x01
    writeFileSync(touched, bytes)
    expect(fileInvariants(cellOf('C-flac-aiff'), flac, touched, aiff.coverSha1)).toEqual([
      { invariant: 'pcm', detail: 'pcm: las muestras no son las del origen' },
    ])
  })

  it('fails tags when an MP3 has TIT1 but no GRP1, which Apple Music reads', () => {
    const mp3 = convertByHand(flac, 'mp3', dir, 'nogrp1')
    editId3(mp3.path, dropGrp1)
    expect(fileInvariants(cellOf('C-flac-mp3'), flac, mp3.path, mp3.coverSha1)).toEqual([
      { invariant: 'tags', detail: "grouping: TIT1 'Peak Time', GRP1 ausente" },
    ])
  })

  it('fails tags when a WAV carries a GRP1 that would shadow the TIT1 other tools edit', () => {
    const wav = convertByHand(flac, 'wav', dir, 'grp1')
    editId3(wav.path, (id3) => setText(id3, GRP1, ['Peak Time']))
    expect(fileInvariants(cellOf('C-flac-wav'), flac, wav.path, wav.coverSha1)).toEqual([
      { invariant: 'tags', detail: "grouping: GRP1 'Peak Time' en un WAV" },
    ])
  })

  it('fails tags for track 312 instead of 3/12, and disc 0 instead of 1/2', () => {
    const out = convertByHand(flac, 'aiff', dir, 'numbers')
    editId3(out.path, (id3) => {
      setText(id3, Id3v2FrameIdentifiers.TRCK, ['312'])
      setText(id3, Id3v2FrameIdentifiers.TPOS, ['0'])
    })
    const broken = fileInvariants(cellOf('C-flac-aiff'), flac, out.path, out.coverSha1)
    expect(broken.every((b) => b.invariant === 'tags')).toBe(true)
    const details = broken.map((b) => b.detail)
    expect(details).toContain("pista: TRCK '312', se esperaba '03/12'")
    expect(details).toContain("disco: TPOS '0', se esperaba '1/2'")
  })

  it('fails tags when AC/DC came back as two artists', () => {
    const mp3 = convertByHand(flac, 'mp3', dir, 'twoartists')
    editId3(mp3.path, (id3) => setText(id3, Id3v2FrameIdentifiers.TPE1, ['AC', 'DC']), 4)
    const broken = fileInvariants(cellOf('C-flac-mp3'), flac, mp3.path, mp3.coverSha1)
    expect(broken.map((b) => b.detail)).toContain("artista: TPE1 'AC' + 'DC', se esperaba 'AC/DC'")
  })

  it.each([
    ['title', 'título'],
    ['album', 'álbum'],
    ['genre', 'género'],
    ['grouping', 'grouping'],
    ['bpm', 'bpm'],
    ['key', 'tonalidad'],
    ['publisher', 'sello'],
    ['catalogNumber', 'catálogo'],
    ['comment', 'comentario'],
  ] as const)('sees a changed %s in AIFF and ALAC frames', (field, label) => {
    for (const target of ['aiff', 'alac'] as OutputFormat[]) {
      const out = convertByHand(flac, target, dir, `${field}-${target}`)
      const changed = field === 'bpm' ? '99' : 'Otro'
      writeTags(out.path, { ...emptyMetadata(), ...TRICKY, [field]: changed })
      const details = fileInvariants(cellOf(`C-flac-${target}`), flac, out.path, out.coverSha1)
        .filter((b) => b.invariant === 'tags')
        .map((b) => b.detail)
      expect(details.some((d) => d.startsWith(`${label}: `))).toBe(true)
    }
  })

  it.each([
    ['TITLE', 'título'],
    ['ARTIST', 'artista'],
    ['ALBUM', 'álbum'],
    ['GENRE', 'género'],
    ['GROUPING', 'grouping'],
    ['TRACKNUMBER', 'pista'],
    ['DISCTOTAL', 'disco'],
    ['TEMPO', 'bpm'],
    ['INITIALKEY', 'tonalidad'],
    ['LABEL', 'sello'],
    ['CATALOGNUMBER', 'catálogo'],
    ['COMMENT', 'comentario'],
  ])('sees a changed Vorbis %s in a FLAC', (key, label) => {
    const out = convertByHand(flac, 'flac', dir, `vorbis-${key}`)
    setVorbis(out.path, [[key, '7']])
    const details = fileInvariants(cellOf('C-flac-flac'), flac, out.path, out.coverSha1).map(
      (b) => b.detail,
    )
    expect(details.some((d) => d.startsWith(`${label}: `))).toBe(true)
  })

  it('fails cover when the picture is another one or gone', () => {
    const out = convertByHand(flac, 'aiff', dir, 'cover')
    writeTags(
      out.path,
      { ...emptyMetadata(), ...padded(TRICKY) },
      coverJpg(join(dir, 'other.jpg'), 20),
    )
    expect(fileInvariants(cellOf('C-flac-aiff'), flac, out.path, out.coverSha1)).toEqual([
      { invariant: 'cover', detail: 'carátula: no es la que se preparó' },
    ])
    writeTags(out.path, { ...emptyMetadata(), ...padded(TRICKY) }, undefined, true)
    expect(fileInvariants(cellOf('C-flac-aiff'), flac, out.path, out.coverSha1)).toEqual([
      { invariant: 'cover', detail: 'carátula: ausente' },
    ])
    expect(fileInvariants(cellOf('C-flac-aiff'), flac, out.path, null)).toEqual([])
  })

  it('judges against the tags this source was seeded with, not the default set', () => {
    const vinyl = makeSource(dir, 'flac', {
      fileName: 'vinyl',
      tags: { title: 'Señal', trackNumber: 'A2' },
    })
    const out = convertByHand(vinyl, 'aiff', dir, 'vinyl-out')
    expect(fileInvariants(cellOf('C-flac-aiff'), vinyl, out.path, out.coverSha1)).toEqual([])
    const asDefault = convertByHand(flac, 'aiff', dir, 'default-out')
    const details = fileInvariants(
      cellOf('C-flac-aiff'),
      vinyl,
      asDefault.path,
      asDefault.coverSha1,
    ).map((b) => b.detail)
    expect(details).toContain("pista: TRCK '03/12', se esperaba 'A2'")
    expect(details).toContain("título: TIT2 'Café Olé', se esperaba 'Señal'")
  })

  it('reports a WAV with a wrong TIT1 and a GRP1 as two grouping problems', () => {
    const wav = convertByHand(flac, 'wav', dir, 'grp1-and-tit1')
    editId3(wav.path, (id3) => {
      setText(id3, Id3v2FrameIdentifiers.TIT1, ['Warm Up'])
      setText(id3, GRP1, ['Peak Time'])
    })
    expect(fileInvariants(cellOf('C-flac-wav'), flac, wav.path, wav.coverSha1)).toEqual([
      { invariant: 'tags', detail: "grouping: TIT1 'Warm Up', se esperaba 'Peak Time'" },
      { invariant: 'tags', detail: "grouping: GRP1 'Peak Time' en un WAV" },
    ])
  })

  it('fails cover for a FLAC whose only picture rides a leading ID3 tag Traktor and rekordbox skip', () => {
    const path = join(dir, 'id3cover Café Olé.flac'.normalize('NFD'))
    const cover = coverJpg(join(dir, 'id3cover.jpg'))
    encodeFlac(flac, path, null)
    prependFlacId3(path, { ...emptyMetadata(), ...flac.tags }, cover)
    const finder = { ...cellOf('C-flac-flac'), settings: { flacFinderCovers: true } }
    expect(fileInvariants(finder, flac, path, sha1(cover))).toEqual([
      { invariant: 'cover', detail: 'carátula: ausente' },
    ])
  })

  it('fails format for a FLAC with an ID3 tag in front, unless Finder covers were asked for', () => {
    const out = convertByHand(flac, 'flac', dir, 'finder')
    prependFlacId3(out.path, { ...emptyMetadata(), ...flac.tags }, join(dir, 'finder.cover.jpg'))
    expect(fileInvariants(cellOf('C-flac-flac'), flac, out.path, out.coverSha1)).toEqual([
      { invariant: 'format', detail: 'formato: FLAC con ID3 delante' },
    ])
    const finder = { ...cellOf('C-flac-flac'), settings: { flacFinderCovers: true } }
    expect(fileInvariants(finder, flac, out.path, out.coverSha1)).toEqual([])
  })

  it('finds an NFD-named output asked for by its NFC name', () => {
    const asked = aiff.path.normalize('NFC')
    expect(asked).not.toBe(aiff.path)
    expect(fileInvariants(cellOf('C-flac-aiff'), flac, asked, aiff.coverSha1)).toEqual([])
  })

  it('reports a missing output as format, not as a crash', () => {
    expect(fileInvariants(cellOf('C-flac-aiff'), flac, join(dir, 'nada.aiff'), null)).toEqual([
      { invariant: 'format', detail: 'formato: el fichero final no existe' },
    ])
  })

  it('measures the lag of a 2 s trim as -2000 ms', () => {
    const lead = makeSource(dir, 'wav16', { leadSilenceSec: 2, fileName: 'lead' })
    const trimmed = join(dir, 'trimmed.wav')
    execFileSync(FF, [
      '-y',
      '-v',
      'error',
      '-i',
      lead.path,
      '-af',
      'atrim=start=2,asetpts=PTS-STARTPTS',
      '-c:a',
      'pcm_s16le',
      trimmed,
    ])
    expect(markerLagMs(lead.path, trimmed)).toBeCloseTo(-2000, 1)
  })

  // The adaptive gate cuts where the silence really ends, not a fixed 2 s; the oracle takes
  // the cut from where the marker moved and demands nothing else went missing.
  describe('a trimmed result', () => {
    const lead = makeSource(dir, 'wav24', { leadSilenceSec: 2, fileName: 'trim-lead' })
    const cut = (name: string, filter: string) => {
      const out = join(dir, `${name}.aiff`)
      execFileSync(FF, [
        '-y',
        '-v',
        'error',
        '-i',
        lead.path,
        '-af',
        filter,
        '-c:a',
        'pcm_s24be',
        out,
      ])
      return fileInvariants(cellOf('Q-trim-wav24'), lead, out, null).filter(
        (b) => b.invariant === 'pcm',
      )
    }

    it('accepts the 1.9 s the gate cut', () => {
      expect(cut('trim-19', 'atrim=start=1.9,asetpts=PTS-STARTPTS')).toEqual([])
    })

    it('sees the tail cut as well', () => {
      expect(cut('trim-tail', 'atrim=start=1.9:end=21.5,asetpts=PTS-STARTPTS')).toEqual([
        { invariant: 'pcm', detail: expect.stringContaining('pcm: dura') },
      ])
    })

    it('sees a cut that ate into the music', () => {
      expect(cut('trim-deep', 'atrim=start=2.5,asetpts=PTS-STARTPTS')).toEqual([
        { invariant: 'pcm', detail: expect.stringContaining('pcm: el recorte quitó 2.50 s') },
      ])
    })

    it('sees a trim that cut nothing', () => {
      expect(cut('trim-none', 'anull')).toEqual([
        { invariant: 'pcm', detail: expect.stringContaining('pcm: el recorte quitó 0.00 s') },
      ])
    })
  })

  it('shifts Traktor cues by the calibration djotas measured in Traktor', () => {
    expect(traktorCalibrationMs('.mp3', '.aiff')).toBe(-51)
    expect(traktorCalibrationMs('.mp3', '.aif')).toBe(-51)
    expect(traktorCalibrationMs('.MP3', '.flac')).toBe(-51)
    expect(traktorCalibrationMs('.wav', '.mp3')).toBe(51)
    expect(traktorCalibrationMs('.flac', '.mp3')).toBe(51)
    expect(traktorCalibrationMs('.aiff', '.mp3')).toBe(51)
    expect(traktorCalibrationMs('.mp3', '.wav')).toBe(0)
    expect(traktorCalibrationMs('.mp3', '.mp3')).toBe(0)
    expect(traktorCalibrationMs('.mp3', '.m4a')).toBe(0)
    expect(traktorCalibrationMs('.m4a', '.mp3')).toBe(0)
    expect(traktorCalibrationMs('.flac', '.aiff')).toBe(0)
  })

  // rekordbox counts cue milliseconds from its own start, which is not where ffmpeg starts:
  // an MP3 with an Info/Xing frame starts one frame (1152 samples) later, plus the encoder
  // delay and the decoder's 529 when the frame is LAME-signed, and an .m4a after the 2112
  // AAC priming samples. Seen in C-flac-mp3 and D12 (cues at 10026, 15026 on a Lavc MP3),
  // K09 (9974, 14974 from an mp3x) and C-aiff-alac (10048, 15048 on an .m4a).
  it("places rekordbox's timeline where rekordbox starts counting on each kind of file", () => {
    const mp3x = makeSource(dir, 'mp3x', { fileName: 'timeline-x' })
    const lame = join(dir, 'timeline-lame.mp3')
    const bytes = readFileSync(mp3x.path)
    const signature = bytes.indexOf('Lavc', bytes.indexOf('Info'))
    bytes.write('LAME', signature, 'latin1')
    writeFileSync(lame, bytes)
    const info = bytes.indexOf('Info')
    const noToc = Buffer.concat([
      bytes.subarray(0, info + 16),
      bytes.subarray(info + 116, info + 400),
      Buffer.alloc(100),
      bytes.subarray(info + 400),
    ])
    noToc.writeUInt32BE(noToc.readUInt32BE(info + 4) & ~4, info + 4)
    const lameNoToc = join(dir, 'timeline-lame-sin-toc.mp3')
    writeFileSync(lameNoToc, noToc)
    const mp3at48k = join(dir, 'timeline-48k.mp3')
    execFileSync(FF, [
      '-y',
      '-v',
      'error',
      '-i',
      mp3x.path,
      '-ar',
      '48000',
      ...ENCODE.mp3.args,
      mp3at48k,
    ])
    const table: [string, number][] = [
      [mp3x.path, (1152 / 44100) * 1000],
      [lame, ((1152 + 576 + 529) / 44100) * 1000],
      [lameNoToc, ((1152 + 576 + 529) / 44100) * 1000],
      [mp3at48k, (1152 / 48000) * 1000],
      [makeSource(dir, 'mp3n', { fileName: 'timeline-n' }).path, 0],
      [makeSource(dir, 'mp3j', { fileName: 'timeline-j' }).path, 0],
      [makeSource(dir, 'alac', { fileName: 'timeline-alac' }).path, (2112 / 44100) * 1000],
      [makeSource(dir, 'wav16', { fileName: 'timeline-wav' }).path, 0],
      [makeSource(dir, 'aiff', { fileName: 'timeline-aiff' }).path, 0],
      [flac.path, 0],
    ]
    for (const [path, ms] of table) expect(rekordboxTimelineMs(path), path).toBeCloseTo(ms, 2)
  })

  // Surco's Originals are a way back, not a loss: only the system Trash, a file gone for
  // good, or an offer to delete it count, and only while the self-check has not said ok.
  describe('what became of the original', () => {
    const source = join(dir, 'orig.flac')
    const final = join(dir, 'orig.aiff')
    const base = { sourcePath: source, finalPath: final, originals: [], osTrash: [], offered: null }

    it('accepts an original kept in Originals whatever the verdict', () => {
      expect(originalBroken({ ...base, status: 'mismatch', originals: [source] })).toEqual([])
    })

    it('sees the original sent to the system Trash before the verdict was ok', () => {
      expect(originalBroken({ ...base, status: 'mismatch', osTrash: [source] })).toEqual([
        {
          invariant: 'unique',
          detail: 'papelera: el original fue a la Papelera con el veredicto mismatch',
        },
      ])
      expect(originalBroken({ ...base, status: 'ok', osTrash: [source] })).toEqual([])
    })

    it('sees the original gone for good before the verdict was ok', () => {
      expect(originalBroken({ ...base, status: 'pending' })).toEqual([
        { invariant: 'unique', detail: 'papelera: el original se borró con el veredicto pending' },
      ])
    })

    it('sees a deletion offered before the verdict was ok', () => {
      expect(
        originalBroken({ ...base, status: undefined, originals: [source], offered: source }),
      ).toEqual([
        {
          invariant: 'unique',
          detail: 'papelera: se ofrece borrar el original con el veredicto ninguno',
        },
      ])
    })
  })

  it('measures mp3x and mp3n lags separately', () => {
    // Hand measurement, 30/10, bundled ffmpeg, same encode as sources.ts:
    //   SIG="aevalsrc=if(lt(t\,0)\,0\,0.95*sin(2*PI*55*(t-0))*exp(-4*mod(t-0\,0.5)))+eq(n\,441000)*0.8:s=44100:d=20"
    //   ffmpeg -f lavfi -i "$SIG" -ac 2 -c:a libmp3lame -b:a 320k -write_id3v2 0 -write_xing 1 x.mp3   (and 0 for n.mp3)
    //   ffmpeg -v error -i F -ac 1 -f s16le - | od -An -v -t d2 | awk '{max |x[i]-x[i-1]|}'
    //   wav 441000, x.mp3 441000 (0 ms), n.mp3 442105 (+1105 samples = 25.057 ms)
    //   silencedetect behind highpass=f=8000 agrees: x.mp3 ~10.000 s, n.mp3 ~10.025 s
    const wav = makeSource(dir, 'wav16', { fileName: 'lag-ref' })
    const mp3x = makeSource(dir, 'mp3x', { fileName: 'lag-x' })
    const mp3n = makeSource(dir, 'mp3n', { fileName: 'lag-n' })
    expect(markerLagMs(wav.path, mp3x.path)).toBeCloseTo(0, 1)
    expect(markerLagMs(wav.path, mp3n.path)).toBeCloseTo(25.057, 1)
  })
})
