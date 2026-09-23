import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

vi.mock('./settings', () => ({
  getSettings: () => ({
    syncTraktor: true,
    traktorNmlPath: '/nowhere/collection.nml',
    traktorCueOffsetMs: -51,
  }),
}))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { beginNmlBatch, endNmlBatch } from './nmlBatch'
import { buildTraktorTree, traktorCue } from './traktor4Fixture'
import { applyPatches } from './traktorNml'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-nmlshift-'))

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
  bpm: '128',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

function id3WithCue(tree: Uint8Array): Buffer {
  const owner = Buffer.from('TRAKTOR4\0', 'latin1')
  const body = Buffer.concat([owner, Buffer.from(tree)])
  const head = Buffer.alloc(10)
  head.write('PRIV', 0, 'latin1')
  head.writeUInt32BE(body.length, 4)
  const frames = Buffer.concat([head, body])
  const tag = Buffer.alloc(10)
  tag.write('ID3', 0, 'latin1')
  tag[3] = 3
  const size = frames.length
  tag[6] = (size >> 21) & 0x7f
  tag[7] = (size >> 14) & 0x7f
  tag[8] = (size >> 7) & 0x7f
  tag[9] = size & 0x7f
  return Buffer.concat([tag, frames])
}

let src: string

beforeAll(() => {
  const wav = join(dir, 's.wav')
  src = join(dir, 's.mp3')
  execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=20', wav])
  execFileSync(FF, ['-y', '-v', 'error', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '320k', src])
  writeFileSync(
    src,
    Buffer.concat([
      id3WithCue(buildTraktorTree([traktorCue('Intro', 0, 10000, 1)])),
      readFileSync(src),
    ]),
  )
})

// The hotcues that live only in the collection describe the same audio as the ones in the
// file, so the collection write has to move them by exactly what the conversion moved the
// file's. The patch is the only thing that crosses from the conversion to that write: if it
// does not carry the shift, the collection's own cues stay put while their neighbours move.
describe('the collection patch a conversion records', () => {
  it('moves the cues only the collection holds as far as the file ones moved', async () => {
    beginNmlBatch()
    await convertAudio(src, src, 'mp3', meta)
    const patches = endNmlBatch()
    const nml = `<NML VERSION="20"><COLLECTION ENTRIES="1">
<ENTRY TITLE="T"><LOCATION DIR="${patches[0]?.dir}" FILE="s.mp3" VOLUME="${patches[0]?.volume}"></LOCATION><CUE_V2 NAME="Intro" DISPL_ORDER="0" TYPE="0" START="10000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="1"></CUE_V2><CUE_V2 NAME="Break" DISPL_ORDER="0" TYPE="0" START="45000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="2"></CUE_V2></ENTRY>
</COLLECTION></NML>`

    const out = applyPatches(nml, patches)

    expect(out).toContain('NAME="Intro" DISPL_ORDER="0" TYPE="0" START="9949.000000"')
    expect(out).toContain('NAME="Break" DISPL_ORDER="0" TYPE="0" START="44949.000000"')
  })
})
