import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))
vi.mock('./renameRetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./renameRetry')>()),
  renameWithRetry: async () => {
    throw Object.assign(new Error('Unknown system error -83'), { code: 'Unknown system error -83' })
  },
}))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { configureOriginalKeeper, configureOriginalRestorer } from './originalKeeper'
import { createSurcoTrash } from './surcoTrash'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-rename-failure-'))
const trash = createSurcoTrash(join(dir, 'trash'))

const meta: TrackMetadata = {
  title: 'Yoghi Bear',
  artist: 'Francesco Grant',
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
}

function encode(name: string): string {
  const out = join(dir, name)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-c:a',
    'libmp3lame',
    out,
  ])
  return out
}

beforeAll(() => {
  configureOriginalKeeper((path, reason, outputPath) => trash.stash(path, reason, outputPath))
  configureOriginalRestorer((entry) => trash.restore(entry.id).then(() => {}))
})
afterAll(() => {
  configureOriginalKeeper(null)
  configureOriginalRestorer(null)
})

// Reported from an external disk: the final rename of a rewrite failed (-83, later EEXIST)
// after the original had already been moved into Originals, and the temp was deleted. The
// track vanished from the user's folder and survived only in Originals, which empties itself
// after a week. A conversion that fails must leave the user's file exactly where it was.
describe('a rewrite whose final rename fails', () => {
  it('puts the original back on its own path instead of leaving it in Originals', async () => {
    const src = encode('Francesco Grant - Yoghi Bear [cápsula] 2009.mp3')
    const originalBytes = readFileSync(src)

    await expect(convertAudio(src, src, 'mp3', meta)).rejects.toThrow('-83')

    expect(readFileSync(src).equals(originalBytes)).toBe(true)
    expect((await trash.list()).find((e) => e.originalPath === src)).toBeUndefined()
  })
})
