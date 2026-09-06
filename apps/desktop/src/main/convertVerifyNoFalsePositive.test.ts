import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { OutputFormat, TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-nofalse-'))

const meta: TrackMetadata = {
  title: 'T',
  artist: 'A',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
  discogsReleaseId: '',
  rating: '',
  composer: '',
  isrc: '',
  mixName: '',
  originalYear: '',
  compilation: '',
  mood: '',
  energy: '',
}

const sources: Record<string, string> = {}

beforeAll(() => {
  // One source per container the conversion paths actually branch on: the two that
  // take the in-place stream-copy route (mp3, aiff), the two that carry their tags
  // through a TagLib pass after the encode (wav, m4a), and flac, whose header-vs-decode
  // drift measured the widest of the six codecs checked (8.00 vs 7.94).
  for (const [ext, codec] of Object.entries({
    mp3: 'libmp3lame',
    flac: 'flac',
    wav: 'pcm_s16le',
    aiff: 'pcm_s16be',
    m4a: 'alac',
  })) {
    const path = join(dir, `src.${ext}`)
    execFileSync(FF, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=8',
      '-c:a',
      codec,
      path,
    ])
    sources[ext] = path
  }
})

// The truncation check added alongside this file refuses a converted file whose decode
// falls more than 10% short of what its own header promises. The failure mode that
// would matter far more than the bug it fixes is the opposite one: rejecting good
// conversions, which would take a working feature away from every user rather than
// protect a rare one. The threshold was set from measurements (0.25%-0.75% normal drift
// across six codecs, 76% on a truncated file), and these are the conversions that have
// to keep passing for that number to be safe.
describe('la verificación de truncado no rechaza conversiones legítimas', () => {
  it.each<[string, OutputFormat]>([
    ['mp3', 'mp3'],
    ['flac', 'flac'],
    ['wav', 'wav'],
    ['aiff', 'aiff'],
    ['m4a', 'alac'],
  ])('acepta una conversión %s a %s en el mismo formato', async (from, to) => {
    const out = join(dir, `same-${from}.${to === 'alac' ? 'm4a' : to}`)
    await convertAudio(sources[from], out, to, meta)
    expect(existsSync(out)).toBe(true)
  })

  it.each<[string, OutputFormat]>([
    ['mp3', 'flac'],
    ['flac', 'mp3'],
    ['aiff', 'flac'],
    ['wav', 'flac'],
    ['flac', 'wav'],
    ['mp3', 'aiff'],
  ])('acepta una conversión de %s a %s', async (from, to) => {
    const out = join(dir, `cross-${from}-${to}.${to}`)
    await convertAudio(sources[from], out, to, meta)
    expect(existsSync(out)).toBe(true)
  })

  // El caso que de verdad podía dar falso positivo: un recorte hace el fichero MÁS
  // CORTO a propósito. No dispara porque los dos lados de la comparación salen del
  // propio temporal — medido: un MP3 recortado de 8 s a 4 s declara 04.05 en su
  // cabecera, no 08.05, así que el recorte se cancela solo.
  it('acepta una conversión recortada, que sale corta a propósito', async () => {
    const out = join(dir, 'trimmed.flac')
    await convertAudio(
      sources.flac,
      out,
      'flac',
      meta,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { startSec: 2, endSec: 6 },
    )
    expect(existsSync(out)).toBe(true)
  })

  // Un fichero por debajo del mínimo verificable tiene que pasar sin más: su redondeo
  // es una fracción grande de sí mismo y no hay ratio en la que confiar.
  it('acepta un fichero demasiado corto para verificarlo', async () => {
    const short = join(dir, 'short.mp3')
    execFileSync(FF, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-c:a',
      'libmp3lame',
      short,
    ])
    const out = join(dir, 'short-out.flac')
    await convertAudio(short, out, 'flac', meta)
    expect(existsSync(out)).toBe(true)
  })
})
