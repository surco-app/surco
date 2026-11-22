import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
import { convertAudio, toNmlLocation } from './ffmpeg'
import { beginNmlBatch, endNmlBatch } from './nmlBatch'
import { buildTraktorTree, traktorCue } from './traktor4Fixture'
import { applyPatches } from './traktorNml'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-nmlreplace-'))

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

let oldPath: string
let download: string
let out: string

beforeAll(() => {
  mkdirSync(join(dir, 'library'))
  mkdirSync(join(dir, 'downloads'))
  const wav = join(dir, 's.wav')
  oldPath = join(dir, 'library', 'old.mp3')
  download = join(dir, 'downloads', 'download.mp3')
  out = join(dir, 'library', 'Song.aiff')
  execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=20', wav])
  execFileSync(FF, ['-y', '-v', 'error', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '320k', oldPath])
  execFileSync(FF, ['-y', '-v', 'error', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '320k', download])
  writeFileSync(
    download,
    Buffer.concat([
      id3WithCue(buildTraktorTree([traktorCue('Intro', 0, 5000, 1)])),
      readFileSync(download),
    ]),
  )
})

const replaceArgs = (): Parameters<typeof convertAudio> => [
  download,
  out,
  'aiff',
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
  undefined,
  undefined,
  oldPath,
]

// Traktor has the file the new one replaces, not the download. An entry addressed to the
// download matches nothing, so the DJ's playlists, play count and cues stay on a track that
// is about to be retired while the converted one shows up as a stranger.
describe('the collection patch a replace records', () => {
  it('addresses the patch to the replaced file, which is the one Traktor has', async () => {
    beginNmlBatch()
    await convertAudio(...replaceArgs())
    const [patch] = endNmlBatch()

    expect(patch).toMatchObject({
      ...toNmlLocation(oldPath),
      relocates: true,
      outputFile: 'Song.aiff',
    })
    expect(patch?.newFile).toBeUndefined()
  })

  // The download's tag and the codec offset describe download to output. The cues in the
  // collection belong to the old file, so moving them by those would shift every hotcue the
  // DJ placed by ear for a change that never happened to that audio.
  it('leaves the cues to the entry, not to the download or its codec offset', async () => {
    beginNmlBatch()
    await convertAudio(...replaceArgs())
    const patches = endNmlBatch()
    const old = toNmlLocation(oldPath)
    const nml = `<NML VERSION="20"><COLLECTION ENTRIES="1">
<ENTRY TITLE="T"><LOCATION DIR="${old.dir}" FILE="old.mp3" VOLUME="${old.volume}"></LOCATION><CUE_V2 NAME="Intro" DISPL_ORDER="0" TYPE="0" START="10000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="1"></CUE_V2></ENTRY>
</COLLECTION></NML>`

    expect(patches[0]?.cueTree).toBeUndefined()
    expect(patches[0]?.cueShift).toBeUndefined()
    const result = applyPatches(nml, patches)
    expect(result).toContain('START="10000.000000"')
    expect(result).toContain('FILE="Song.aiff"')
  })

  // Without a replace nothing may move: the entry of a plain conversion stays on the file
  // Traktor knows, and only a same-folder output is allowed to rename it.
  it('an ordinary conversion still records no move', async () => {
    beginNmlBatch()
    await convertAudio(download, out, 'aiff', meta)
    const [patch] = endNmlBatch()

    expect(patch?.relocates).toBeUndefined()
    expect(patch).toMatchObject(toNmlLocation(download))
  })
})
