import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { File as TagFile } from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { emptyMetadata } from '../shared/metadata'
import { writeTags } from './tags'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-tracknumber-'))

let n = 0
function written(ext: string, trackNumber: string, trackTotal = '', disc = {}) {
  const file = join(dir, `t-${n++}.${ext}`)
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=d=1',
    ...(ext === 'm4a' ? ['-c:a', 'alac'] : []),
    file,
  ])
  writeTags(file, { ...emptyMetadata(), title: 'T', trackNumber, trackTotal, ...disc })
  const f = TagFile.createFromPath(file)
  try {
    if (Object.keys(disc).length > 0) return { disc: f.tag.disc, discs: f.tag.discCount }
    return { track: f.tag.track, total: f.tag.trackCount }
  } finally {
    f.dispose()
  }
}

// MP4's trkn atom and TagLib's generic track hold integers: "3/12" read as one number came
// out as track 312, and the total the value carried was lost.
describe('writeTags — the numeric track', () => {
  it.each(['m4a', 'flac'])('a %s given 3/12 holds track 3 of 12', (ext) => {
    expect(written(ext, '3/12')).toEqual({ track: 3, total: 12 })
  })

  it('a total of its own wins over the one inside the track number', () => {
    expect(written('m4a', '3/12', '14')).toEqual({ track: 3, total: 14 })
  })

  it.each([
    ['A2', 2],
    ['07', 7],
    ['5', 5],
  ])('an M4A given %s holds track %i', (value, track) => {
    expect(written('m4a', value)).toEqual({ track, total: 0 })
  })
})

// The disc slots are integers in every container: "1/2" read as one number was not a
// number at all, so the disc and its total were dropped.
describe('writeTags — the numeric disc', () => {
  it.each(['m4a', 'flac', 'mp3', 'aiff'])('a %s given disc 1/2 holds disc 1 of 2', (ext) => {
    expect(written(ext, '', '', { discNumber: '1/2' })).toEqual({ disc: 1, discs: 2 })
  })

  it('a disc total of its own wins over the one inside the disc number', () => {
    expect(written('flac', '', '', { discNumber: '1/2', discTotal: '3' })).toEqual({
      disc: 1,
      discs: 3,
    })
  })

  it('a plain disc number is kept as it is', () => {
    expect(written('m4a', '', '', { discNumber: '2' })).toEqual({ disc: 2, discs: 0 })
  })
})
