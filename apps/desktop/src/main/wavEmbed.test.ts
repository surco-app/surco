import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import ffmpegStatic from 'ffmpeg-static'
import type { TrackMetadata } from '../shared/types'
import { convertAudio, extractCover, readTags } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-wav-'))
const flac = join(dir, 'in.flac')
const cover = join(dir, 'cover.jpg')

const meta: TrackMetadata = {
  title: 'Elastic Pump',
  artist: 'Javi Soria',
  album: 'Elastic Pump',
  albumArtist: 'Javi Soria',
  year: '2024',
  genre: 'Electronic',
  grouping: 'Set A',
  comment: '',
  trackNumber: '1',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

beforeAll(() => {
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=300x300:d=1',
    '-frames:v',
    '1',
    cover,
  ])
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-c:a',
    'flac',
    flac,
  ])
})

// WAV's RIFF container can't hold an attached-picture stream, but it can carry a
// full ID3v2 tag in an embedded "id3 " chunk — which is where artwork and the
// grouping field have to live. Without it a WAV Surco produced comes back with no
// cover and no grouping when re-imported, even though the audio is intact.
describe('WAV output embeds artwork and grouping the way it can be read back', () => {
  it('round-trips the cover through an exported WAV', async () => {
    const out = join(dir, 'out.wav')
    await convertAudio(flac, out, 'wav', meta, cover)
    expect(await extractCover(out)).not.toBeNull()
  })

  it('round-trips the grouping field through an exported WAV', async () => {
    const out = join(dir, 'out2.wav')
    await convertAudio(flac, out, 'wav', meta, cover)
    expect((await readTags(out)).grouping).toBe('Set A')
  })
})
