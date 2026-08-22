import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { ffprobePath } from './binaries'
import { convertAudio, readMeta } from './ffmpeg'
import { writeTags } from './tags'

const FF = ffmpegStatic as unknown as string

const meta: TrackMetadata = {
  title: 'Till I Come',
  artist: 'ATB',
  album: 'Movin Melodies',
  albumArtist: 'ATB',
  year: '1999',
  genre: 'Trance',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: 'Kontor',
  catalogNumber: '',
  remixArtist: '',
}

let dir: string
let source: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'surco-label-'))
  source = join(dir, 'source.wav')
  execFileSync(FF, [
    '-v',
    'quiet',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-y',
    source,
  ])
})

// Reads the finished file the way any other program would, rather than trusting the
// arguments we handed ffmpeg. That distinction is the whole point of this suite: the
// existing coverage asserted `args` contained "publisher=Kontor", which stays true even
// when the container drops the tag on the way out — and it does on AIFF and WAV.
function labelOf(path: string): string {
  const out = execFileSync(
    ffprobePath,
    ['-v', 'error', '-show_entries', 'format_tags', '-of', 'default=nk=0:nw=1', path],
    { encoding: 'utf8' },
  )
  const line = out.split('\n').find((l) => /kontor/i.test(l))
  return line ? line.trim() : ''
}

// djotas: "label desaparece tras convertirse — solo se mantiene si actualizas mp3, lo
// demás desaparece aif wav". The label survived to MP3 and (since the previous fix) to
// FLAC, but a conversion to AIFF or WAV silently dropped it.
describe('the record label survives a conversion', () => {
  for (const format of ['mp3', 'flac', 'aiff', 'wav'] as const) {
    it(`is still on the file after converting to ${format}`, async () => {
      const out = join(dir, `out.${format}`)
      await convertAudio(source, out, format, meta)
      const raw = require('node:fs').readFileSync(out)
      const idx = raw.indexOf(Buffer.from('Kontor','latin1')) >= 0 ? raw.indexOf(Buffer.from('Kontor','latin1')) : raw.indexOf(Buffer.from('Kontor','utf16le'))
      const ctx = idx >= 0 ? raw.subarray(Math.max(0, idx - 24), idx + 8).toString('latin1').replace(/[^\x20-\x7e]/g, '.') : '(no aparece)'
      require('node:fs').appendFileSync('/tmp/label-formats.txt', `${format.padEnd(5)} ${ctx}
`)
      expect(labelOf(out)).not.toBe('')
    })
  }
})

// The other half of the report: djotas says the label survives when he UPDATES an MP3 but
// not the other formats. An update never re-encodes — it edits the existing file through
// writeTags — so it exercises a different path from the conversion above, and the reread
// is what the editor shows him.
describe('the record label survives an update', () => {
  for (const format of ['mp3', 'flac', 'aiff', 'wav'] as const) {
    it(`is still readable after updating a ${format} in place`, async () => {
      const file = join(dir, `update.${format}`)
      await convertAudio(source, file, format, { ...meta, publisher: '' })

      writeTags(file, meta)

      const reread = await readMeta(file)
      expect(reread.tags.publisher).toBe('Kontor')
    })
  }
})

// djotas' exact cases: "tanto mp3 a wav, mp3 aiff, flac a mp3". These are format CHANGES
// between real containers, not the wav-source conversions above — the source carries its
// own tag, and what matters is whether the label crosses over into the new one.
describe('the record label survives a format change', () => {
  const CASES = [
    ['mp3', 'wav'],
    ['mp3', 'aiff'],
    ['flac', 'mp3'],
    ['wav', 'aiff'],
    ['wav', 'mp3'],
  ] as const

  for (const [from, to] of CASES) {
    it(`carries the label from ${from} to ${to}`, async () => {
      const src = join(dir, `chain-src.${from}`)
      await convertAudio(source, src, from, meta)
      // The source must genuinely carry the label, or the assertion below is vacuous.
      expect((await readMeta(src)).tags.publisher).toBe('Kontor')

      const out = join(dir, `chain-${from}-${to}.${to}`)
      await convertAudio(src, out, to, meta)

      expect((await readMeta(out)).tags.publisher).toBe('Kontor')
    })
  }
})

// The full round trip as the app performs it: the editor READS the tags off the file and
// hands those back to the conversion. If the read misses the label the write can never
// restore it — the field arrives empty and the new file is written without it, which is
// exactly "it disappears after converting".
describe('the label read back off a file feeds the next conversion', () => {
  for (const [from, to] of [
    ['mp3', 'wav'],
    ['mp3', 'aiff'],
    ['flac', 'mp3'],
    ['aiff', 'flac'],
    ['wav', 'mp3'],
  ] as const) {
    it(`survives ${from} -> reread -> ${to}`, async () => {
      const src = join(dir, `rt-src.${from}`)
      await convertAudio(source, src, from, meta)

      // What the editor would show, and hand back on save.
      const asRead = (await readMeta(src)).tags

      const out = join(dir, `rt-${from}-${to}.${to}`)
      await convertAudio(src, out, to, asRead)

      expect((await readMeta(out)).tags.publisher).toBe('Kontor')
    })
  }
})

import { existsSync } from 'node:fs'

// djotas' own file, through djotas' own conversions. Synthetic fixtures have said the
// label survives every path; his does not, so the difference has to be in the file.
const REAL = '/Users/vicent/Desktop/problema-cues/Chab And Jd Davis - Get High (The Club Science Edit).mp3'

describe.skipIf(!existsSync(REAL))("djotas' own file", () => {
  for (const to of ['wav', 'aiff', 'flac', 'mp3'] as const) {
    it(`keeps the label converting his mp3 to ${to}`, async () => {
      const asRead = (await readMeta(REAL)).tags
      expect(asRead.publisher).toBe('Platipus Music GB')

      const out = join(dir, `real-to.${to}`)
      await convertAudio(REAL, out, to, asRead)

      expect((await readMeta(out)).tags.publisher).toBe('Platipus Music GB')
    })
  }
})

// The field NAMES as they sit in the file, which is what a program matching on them sees.
// ffprobe normalises Vorbis LABEL, PUBLISHER and ORGANIZATION all to "publisher", so it
// cannot answer this question — only the raw bytes can.
function rawVorbisFields(path: string): string[] {
  const buf = require('node:fs').readFileSync(path) as Buffer
  // Whole file: on a 20MB source the Vorbis block can sit past any fixed window, and a
  // short read comes back empty rather than wrong — which reads as "the field is missing".
  const text = buf.toString('latin1')
  return [...text.matchAll(/(LABEL|PUBLISHER|ORGANIZATION)=/g)].map((m) => m[1])
}

// djotas set LABEL and PUBLISHER to different values to see which column in Traktor reads
// which: "sello bueno es label, y sello discografico es publisher". His converted FLACs
// come out with PUBLISHER only, so Traktor's LABEL column is empty. The fix in writeTags
// never applied here — a conversion to FLAC lets ffmpeg write the tags and never takes a
// TagLib pass at all (that only happens for .wav and .m4a).
describe('a FLAC conversion writes the label where Traktor reads it', () => {
  it('carries LABEL, not only PUBLISHER', async () => {
    const out = join(dir, 'traktor-label.flac')
    await convertAudio(source, out, 'flac', meta)

    // Both, not one or the other: djotas reads LABEL in one Traktor column and PUBLISHER
    // in another, and the shops he buys from fill PUBLISHER.
    expect(rawVorbisFields(out)).toContain('LABEL')
    expect(rawVorbisFields(out)).toContain('PUBLISHER')
  })
})

// The same conversion djotas runs, on his own file, checked for the field names Traktor
// actually matches on.
describe.skipIf(!existsSync(REAL))("djotas' file to FLAC carries both spellings", () => {
  it('writes LABEL and PUBLISHER', async () => {
    const asRead = (await readMeta(REAL)).tags
    const out = join(dir, 'djotas-real.flac')
    await convertAudio(REAL, out, 'flac', asRead)

    const names = rawVorbisFields(out)
    expect(names).toContain('LABEL')
    expect(names).toContain('PUBLISHER')
    expect((await readMeta(out)).tags.publisher).toBe('Platipus Music GB')
  })
})
