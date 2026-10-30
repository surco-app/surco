import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import ffmpegStatic from 'ffmpeg-static'
import { PictureType, File as TagFile, TagTypes, type XiphComment } from 'node-taglib-sharp'
import { describe, expect, it } from 'vitest'
import { leadingId3v2Size } from '../../main/id3Header'
import { readTagLibFields } from '../../main/tags'
import { readTraktorCueStart, storedTree } from '../../main/traktor4Fixture'
import { embeddedCover, scenarioDir } from '../fixtures'
import type { Origin } from './cells'
import { leadingTagsEnd, MARKER_SEC, makeSource, SEEDED_CUES_MS, TRICKY } from './sources'

const FF = ffmpegStatic as unknown as string
const PROBE = ffprobeInstaller.path

const ORIGINS: Origin[] = [
  'wav16',
  'wav24',
  'aif',
  'aiff',
  'flac',
  'alac',
  'aac',
  'mp3x',
  'mp3n',
  'mp3j',
]

const DECLARED: Record<Origin, { codec: string; rate: number; bits: number; ext: string }> = {
  wav16: { codec: 'pcm_s16le', rate: 44100, bits: 16, ext: '.wav' },
  wav24: { codec: 'pcm_s24le', rate: 96000, bits: 24, ext: '.wav' },
  aif: { codec: 'pcm_s16be', rate: 44100, bits: 16, ext: '.aif' },
  aiff: { codec: 'pcm_s16be', rate: 44100, bits: 16, ext: '.aiff' },
  flac: { codec: 'flac', rate: 44100, bits: 16, ext: '.flac' },
  alac: { codec: 'alac', rate: 44100, bits: 16, ext: '.m4a' },
  aac: { codec: 'aac', rate: 44100, bits: 0, ext: '.m4a' },
  mp3x: { codec: 'mp3', rate: 44100, bits: 0, ext: '.mp3' },
  mp3n: { codec: 'mp3', rate: 44100, bits: 0, ext: '.mp3' },
  mp3j: { codec: 'mp3', rate: 44100, bits: 0, ext: '.mp3' },
}

function probe(path: string): { codec: string; rate: number; bits: number; duration: number } {
  const out = JSON.parse(
    execFileSync(PROBE, ['-v', 'error', '-show_streams', '-of', 'json', path]).toString(),
  )
  const s = out.streams.find((x: { codec_type: string }) => x.codec_type === 'audio')
  const bits = Number(s.bits_per_raw_sample || s.bits_per_sample || 0)
  return { codec: s.codec_name, rate: Number(s.sample_rate), bits, duration: Number(s.duration) }
}

function markerSample(path: string, rate: number): number {
  const pcm = execFileSync(
    FF,
    [
      '-v',
      'error',
      '-i',
      path,
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-ar',
      String(rate),
      '-f',
      'f32le',
      '-',
    ],
    { maxBuffer: 1 << 28 },
  )
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4))
  let best = 0
  let at = 0
  for (let i = 1; i < samples.length; i++) {
    const jump = Math.abs(samples[i] - samples[i - 1])
    if (jump > best) {
      best = jump
      at = i
    }
  }
  return at
}

const hasXing = (bytes: Buffer): boolean => {
  const first = leadingId3v2Size(bytes)
  const head = bytes.subarray(first, first + 2048).toString('latin1')
  return head.includes('Xing') || head.includes('Info')
}

describe('matrix sources', () => {
  const dir = scenarioDir('matrix-sources')
  const made = new Map(ORIGINS.map((o) => [o, makeSource(dir, o)]))
  const sourceOf = (origin: Origin) => {
    const track = made.get(origin)
    if (!track) throw new Error(`no source for ${origin}`)
    return track
  }

  it.each(ORIGINS)('makes a %s that is what it says', (origin) => {
    const track = sourceOf(origin)
    const want = DECLARED[origin]
    const p = probe(track.path)
    expect(p.codec).toBe(want.codec)
    expect(p.rate).toBe(want.rate)
    expect(p.bits).toBe(want.bits)
    expect(extname(track.path)).toBe(want.ext)
    expect(p.duration).toBeGreaterThan(19.9)
    expect(track.origin).toBe(origin)
  })

  it.each(ORIGINS)('names the %s file in NFD so a composed-name reader fails loudly', (origin) => {
    const name = basename(sourceOf(origin).path)
    expect(name).toContain('Café Olé')
    expect(name).toBe(name.normalize('NFD'))
  })

  it.each(ORIGINS)('puts the timing click at the marker in the %s', (origin) => {
    const track = sourceOf(origin)
    const rate = DECLARED[origin].rate
    const at = markerSample(track.path, rate)
    const lossy = origin.startsWith('mp3') || origin === 'aac'
    const slack = lossy ? 0.05 * rate : 1
    expect(Math.abs(at - MARKER_SEC * rate)).toBeLessThanOrEqual(slack)
  })

  it.each(ORIGINS)('reads the hard tags back from the %s', (origin) => {
    const read = readTagLibFields(sourceOf(origin).path).extras
    expect(read.title).toBeDefined()
    expect(read.title?.normalize('NFC')).toBe('Café Olé')
    expect(read.artist).toBe(TRICKY.artist)
    expect(read.album).toBe(TRICKY.album)
    expect(read.grouping).toBe(TRICKY.grouping)
    const ext = extname(sourceOf(origin).path)
    if (ext !== '.flac') expect(read.publisher).toBe(TRICKY.publisher)
    if (ext !== '.m4a' && ext !== '.flac') expect(read.catalogNumber).toBe(TRICKY.catalogNumber)
    expect(read.genre?.split(/[,;]\s*/)).toEqual(['House', 'Deep House'])
    expect(read.trackNumber).toBe('3')
    expect(read.trackTotal).toBe('12')
    expect(read.discNumber).toBe('1')
    expect(read.discTotal).toBe('2')
    expect(read.bpm).toBe('124')
    expect(read.key).toBe('8A')
    expect(read.comment).toBe('🔥 promo')
  })

  it('shows Xing only in the mp3x', () => {
    const xing = (o: Origin) => hasXing(readFileSync(sourceOf(o).path))
    expect(xing('mp3x')).toBe(true)
    expect(xing('mp3n')).toBe(false)
  })

  it('puts the mp3j junk right after its ID3 tag and before the first frame', () => {
    const bytes = readFileSync(sourceOf('mp3j').path)
    const tagEnd = leadingTagsEnd(bytes)
    expect(bytes.subarray(0, 3).toString('latin1')).toBe('ID3')
    expect(bytes.subarray(tagEnd, tagEnd + 11).toString('latin1')).toBe('LYRICSBEGIN')
    const junk = bytes.subarray(tagEnd, tagEnd + 4096)
    expect(junk.includes(Buffer.alloc(512))).toBe(true)
    const frame = bytes.indexOf(Buffer.from([0xff, 0xfb]), tagEnd)
    expect(frame - tagEnd).toBeGreaterThan(512)
    expect(leadingId3v2Size(bytes)).toBeGreaterThan(0)
  })

  it.each(['flac', 'wav16', 'wav24', 'aif', 'aiff', 'mp3x', 'mp3n', 'mp3j'] as Origin[])(
    'stores the seeded cues in the %s where Traktor keeps them',
    (origin) => {
      const track = sourceOf(origin)
      const tree = storedTree(track.path)
      expect(tree).not.toBeNull()
      const positions = track.cuesMs.map((_, i) => readTraktorCueStart(tree as Uint8Array, i))
      expect(positions).toEqual(SEEDED_CUES_MS)
      expect(track.cuesMs).toEqual(SEEDED_CUES_MS)
    },
  )

  it.each(['alac', 'aac'] as Origin[])(
    'keeps no cues in the %s, as production has no path',
    (origin) => {
      expect(sourceOf(origin).cuesMs).toEqual([])
    },
  )

  it.each(ORIGINS)('embeds the cover whose sha1 the %s reports', (origin) => {
    const track = sourceOf(origin)
    const cover = embeddedCover(track.path)
    expect(cover).not.toBeNull()
    expect(
      createHash('sha1')
        .update(cover as Buffer)
        .digest('hex'),
    ).toBe(track.coverSha1)
  })

  it('writes the flac like a real FLAC, starting with fLaC and tagged in Vorbis only', () => {
    const track = sourceOf('flac')
    const bytes = readFileSync(track.path)
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('fLaC')
    const f = TagFile.createFromPath(track.path)
    try {
      expect(f.getTag(TagTypes.Id3v2, false)).toBeFalsy()
      const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment
      expect(xiph.getField('TITLE')).toEqual([TRICKY.title])
      expect(xiph.getField('ARTIST')).toEqual([TRICKY.artist])
      expect(xiph.getField('GROUPING')).toEqual([TRICKY.grouping])
      expect(xiph.getField('TRACKNUMBER')).toEqual(['3'])
      expect(xiph.getField('TRACKTOTAL')).toEqual(['12'])
      expect(xiph.getField('DISCNUMBER')).toEqual(['1'])
      expect(xiph.getField('DISCTOTAL')).toEqual(['2'])
      expect(xiph.getField('CATALOGNUMBER')).toEqual([TRICKY.catalogNumber])
      expect(xiph.getField('LABEL')).toEqual([TRICKY.publisher])
      expect(xiph.getField('COMMENT')).toEqual([TRICKY.comment])
      expect(xiph.getField('TRAKTOR4')).toHaveLength(1)
      const pictures = f.tag.pictures
      expect(pictures).toHaveLength(1)
      expect(pictures[0].type).toBe(PictureType.FrontCover)
    } finally {
      f.dispose()
    }
  })

  it('moves the click with the lead silence', () => {
    const track = makeSource(dir, 'wav16', { leadSilenceSec: 2, fileName: 'lead' })
    expect(markerSample(track.path, 44100)).toBe((MARKER_SEC + 2) * 44100)
  })
})
