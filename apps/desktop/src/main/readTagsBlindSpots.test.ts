import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { File as TagFile } from 'node-taglib-sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { readTags } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-readtags-blind-'))

// Tagged the way a TagLib-based tagger (mp3tag, Surco's own writeTags) leaves a file.
function tagged(ext: string, codec: string[]): string {
  const file = join(dir, `t.${ext}`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    ...codec,
    file,
  ])
  const f = TagFile.createFromPath(file)
  try {
    f.tag.title = 'Rave Till My Grave'
    f.tag.performers = ['Ashbreaker']
    f.tag.album = 'MQDRFREE015'
    f.tag.year = 2026
    f.tag.genres = ['HARDSTYLE']
    f.tag.comment = 'A2S B1S'
    f.tag.publisher = 'MQD Records'
    f.tag.beatsPerMinute = 150
    f.tag.initialKey = '11A'
    f.tag.grouping = 'Peak'
    f.save()
  } finally {
    f.dispose()
  }
  return file
}

let aiff: string
let wav: string
let m4a: string
let flac: string

beforeAll(() => {
  aiff = tagged('aiff', ['-c:a', 'pcm_s16be'])
  wav = tagged('wav', ['-c:a', 'pcm_s16le'])
  m4a = tagged('m4a', ['-c:a', 'alac'])
  flac = tagged('flac', ['-c:a', 'flac'])
})

// Every field the probe cannot see is a field an update then erases: readTags feeds the
// editor, the editor's values are what the conversion writes, and a managed field written
// empty clears whatever the file had. Measured on the matrix behind convertUpdateContract
// (17/09/2026): an AIFF update lost its grouping and label, a WAV its artist and album,
// an M4A its BPM — all present on disk, all invisible to ffprobe.
describe('readTags on what ffprobe does not surface', () => {
  it('reads the grouping and label an AIFF keeps in TIT1 and TPUB', async () => {
    const tags = await readTags(aiff)
    expect(tags.grouping).toBe('Peak')
    expect(tags.publisher).toBe('MQD Records')
  })

  // TagLib's INFO chunk spells the album DIRC and the artist ISTR; ffmpeg reads IPRD and
  // IART. The same values sit in the ID3 chunk next to it.
  it('reads the artist and album of a WAV whose INFO chunk uses TagLib spellings', async () => {
    const tags = await readTags(wav)
    expect(tags.artist).toBe('Ashbreaker')
    expect(tags.album).toBe('MQDRFREE015')
  })

  it('reads the BPM an M4A keeps in tmpo', async () => {
    const tags = await readTags(m4a)
    expect(tags.bpm).toBe('150')
  })

  it('reads the BPM a FLAC keeps under TEMPO', async () => {
    const tags = await readTags(flac)
    expect(tags.bpm).toBe('150')
  })
})
