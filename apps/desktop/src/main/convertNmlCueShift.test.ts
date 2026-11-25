import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
import { encodeBase91 } from './base91'
import {
  buildTraktorTree,
  injectAiffPriv,
  readTraktorCueStart,
  storedTree,
  traktorCue,
} from './traktor4Fixture'
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
let bare: string

beforeAll(() => {
  const wav = join(dir, 's.wav')
  src = join(dir, 's.mp3')
  bare = join(dir, 'bare.mp3')
  execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=20', wav])
  execFileSync(FF, ['-y', '-v', 'error', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '320k', src])
  execFileSync(FF, ['-y', '-v', 'error', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '320k', bare])
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
  it('leaves the cues only the collection holds where the file ones stay when it is saved over itself', async () => {
    beginNmlBatch()
    await convertAudio(src, src, 'mp3', meta)
    const patches = endNmlBatch()
    const nml = `<NML VERSION="20"><COLLECTION ENTRIES="1">
<ENTRY TITLE="T"><LOCATION DIR="${patches[0]?.dir}" FILE="s.mp3" VOLUME="${patches[0]?.volume}"></LOCATION><CUE_V2 NAME="Intro" DISPL_ORDER="0" TYPE="0" START="10000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="1"></CUE_V2><CUE_V2 NAME="Break" DISPL_ORDER="0" TYPE="0" START="45000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="2"></CUE_V2></ENTRY>
</COLLECTION></NML>`

    const out = applyPatches(nml, patches)

    expect(out).toContain('NAME="Intro" DISPL_ORDER="0" TYPE="0" START="10000.000000"')
    expect(out).toContain('NAME="Break" DISPL_ORDER="0" TYPE="0" START="45000.000000"')
  })

  // A file Traktor never wrote its cues into is the common case: the DJ set them in the
  // collection only. The trim moves the audio all the same, so a hotcue left where it was
  // now points two seconds into the wrong part of the track.
  it('moves the collection cues when the file carries none of its own', async () => {
    beginNmlBatch()
    await convertAudio(
      bare,
      bare,
      'mp3',
      meta,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { startSec: 2 },
    )
    const patches = endNmlBatch()
    const nml = `<NML VERSION="20"><COLLECTION ENTRIES="1">
<ENTRY TITLE="T"><LOCATION DIR="${patches[0]?.dir}" FILE="bare.mp3" VOLUME="${patches[0]?.volume}"></LOCATION><CUE_V2 NAME="Drop" DISPL_ORDER="0" TYPE="0" START="10000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="1"></CUE_V2></ENTRY>
</COLLECTION></NML>`

    expect(applyPatches(nml, patches)).toContain(
      'NAME="Drop" DISPL_ORDER="0" TYPE="0" START="8000.000000"',
    )
  })
})

function sourceWithDrop(folder: string, ext: string): string {
  const tree = buildTraktorTree([traktorCue('Drop', 0, 10000, 1)])
  const path = join(folder, `track${ext}`)
  const tone = ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=20']
  if (ext === '.flac') {
    execFileSync(FF, [...tone, '-metadata', `TRAKTOR4=${encodeBase91(tree)}`, path])
    return path
  }
  execFileSync(FF, [
    ...tone,
    ...(ext === '.mp3' ? ['-c:a', 'libmp3lame', '-b:a', '320k'] : []),
    path,
  ])
  if (ext === '.aiff') injectAiffPriv(path, tree)
  else writeFileSync(path, Buffer.concat([id3WithCue(tree), readFileSync(path)]))
  return path
}

function collectionWithDrop(patch: { dir: string; volume: string } | undefined, file: string) {
  return `<NML VERSION="20"><COLLECTION ENTRIES="1">
<ENTRY TITLE="T"><LOCATION DIR="${patch?.dir}" FILE="${file}" VOLUME="${patch?.volume}"></LOCATION><CUE_V2 NAME="Drop" DISPL_ORDER="0" TYPE="0" START="10000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="1"></CUE_V2></ENTRY>
</COLLECTION></NML>`
}

// The DJ's offset corrects how a cue placed on this audio feels in Traktor, once. A file
// saved over itself is the same audio with the correction already in it, and the editor
// saves that way on every Save, so applying the offset again walked the cues 51 ms earlier
// each time, in the file and in the collection alike.
describe('a file saved over itself with a cue offset set', () => {
  for (const [format, ext] of [
    ['mp3', '.mp3'],
    ['aiff', '.aiff'],
    ['flac', '.flac'],
  ] as const)
    it(`keeps the ${ext} cues where they were after three saves`, async () => {
      const track = sourceWithDrop(mkdtempSync(join(tmpdir(), 'surco-resave-')), ext)
      let nml: string | undefined

      for (let save = 0; save < 3; save++) {
        beginNmlBatch()
        await convertAudio(track, track, format, meta)
        const patches = endNmlBatch()
        nml = applyPatches(nml ?? collectionWithDrop(patches[0], `track${ext}`), patches)
      }

      expect(readTraktorCueStart(storedTree(track) as Uint8Array, 0)).toBeCloseTo(10000, 0)
      expect(nml).toContain('NAME="Drop" DISPL_ORDER="0" TYPE="0" START="10000.000000"')
    })

  // A tag change can rename the file as it saves (Edit the original): the output is a
  // new path, then the old one is removed, so the path alone cannot tell this is the
  // same audio. processTrack says so through the last argument.
  for (const [format, ext] of [
    ['mp3', '.mp3'],
    ['aiff', '.aiff'],
  ] as const)
    it(`keeps the ${ext} cues where they were after three saves that rename it`, async () => {
      const folder = mkdtempSync(join(tmpdir(), 'surco-rename-'))
      let track = sourceWithDrop(folder, ext)
      let nml: string | undefined

      for (let save = 1; save <= 3; save++) {
        const renamed = join(folder, `track ${save}${ext}`)
        beginNmlBatch()
        await convertAudio(
          track,
          renamed,
          format,
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
          undefined,
          undefined,
          undefined,
          true,
        )
        const patches = endNmlBatch()
        nml = applyPatches(nml ?? collectionWithDrop(patches[0], `track${ext}`), patches)
        rmSync(track)
        track = renamed
      }

      expect(nml).toContain(`FILE="track 3${ext}"`)
      expect(readTraktorCueStart(storedTree(track) as Uint8Array, 0)).toBeCloseTo(10000, 0)
      expect(nml).toContain('NAME="Drop" DISPL_ORDER="0" TYPE="0" START="10000.000000"')
    })

  // A copy in another folder is a new file the DJ has not yet played through the
  // correction, which is what the "the MP3 it converts does not have the -51 ms applied"
  // report asked for.
  it('still moves the cues of a same-format copy written to another folder', async () => {
    const track = sourceWithDrop(mkdtempSync(join(tmpdir(), 'surco-resave-')), '.mp3')
    const copy = join(mkdtempSync(join(tmpdir(), 'surco-export-')), 'track.mp3')

    await convertAudio(track, copy, 'mp3', meta)

    expect(readTraktorCueStart(storedTree(copy) as Uint8Array, 0)).toBeCloseTo(9949, 0)
  })
})
