import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

vi.mock('./settings', () => ({
  getSettings: () => ({
    syncTraktor: false,
    addToTraktor: true,
    traktorNmlPath: '/nowhere/collection.nml',
    traktorCueOffsetMs: -51,
  }),
}))

import type { TrackMetadata } from '../shared/types'
import { convertAudio, toNmlLocation } from './ffmpeg'
import { beginNmlBatch, endNmlBatch } from './nmlBatch'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-nmlreplace-add-'))

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
  rating: '4',
}

let oldPath: string
let download: string
let out: string

beforeAll(() => {
  mkdirSync(join(dir, 'library'))
  mkdirSync(join(dir, 'downloads'))
  oldPath = join(dir, 'library', 'old.mp3')
  download = join(dir, 'downloads', 'download.mp3')
  out = join(dir, 'library', 'Song.aiff')
  execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=5', oldPath])
  execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=5', download])
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

// With Sync Traktor off Surco writes no stars, names, covers or cues to the collection, but
// a replace the DJ asked for is still permission to move its own entry: without the move the
// old entry stays on a file about to be retired and its cues and playlists are lost.
describe('the collection patch a replace records with only Add to Traktor on', () => {
  it('with only Add to Traktor on, a replace records just the move', async () => {
    beginNmlBatch()
    await convertAudio(...replaceArgs())
    const patches = endNmlBatch()

    expect(patches).toHaveLength(1)
    expect(patches[0]).toMatchObject({
      ...toNmlLocation(oldPath),
      relocates: true,
      outputFile: 'Song.aiff',
    })
    expect(patches[0]?.ranking).toBeUndefined()
    expect(patches[0]?.tags).toBeUndefined()
    expect(patches[0]?.refreshCoverArt).toBeUndefined()
    expect(patches[0]?.cueTree).toBeUndefined()
    expect(patches[0]?.bpm).toBeUndefined()
    expect(patches[0]?.outputPath).toBeUndefined()
  })

  // Sync Traktor stays what it was for everything that is not a replace.
  it('with only Add to Traktor on, an ordinary conversion records nothing', async () => {
    beginNmlBatch()
    await convertAudio(download, out, 'aiff', meta)

    expect(endNmlBatch()).toEqual([])
  })
})
