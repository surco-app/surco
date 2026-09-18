import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { removeRenamedOriginal } from './inplace'
import { configureOriginalKeeper } from './originalKeeper'
import { createSurcoTrash } from './surcoTrash'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-keeps-original-'))
const trash = createSurcoTrash(join(dir, 'trash'))

const meta: TrackMetadata = {
  title: 'Kept',
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
})
afterAll(() => configureOriginalKeeper(null))

// "Replace the original" lands the converted file on the source's own path. Before the
// trash existed that rename was the end of the source; now the source goes into Surco's
// trash first, so a conversion that turns out wrong is a restore rather than a loss.
describe('a conversion that lands on its own source', () => {
  it('keeps the original in the trash and puts the conversion in its place', async () => {
    const src = encode('rewrite.mp3')
    const originalBytes = readFileSync(src)
    await convertAudio(src, src, 'mp3', meta)

    const entries = await trash.list()
    const kept = entries.find((e) => e.originalPath === src)
    expect(kept).toMatchObject({ reason: 'replaced', outputPath: src, bytes: originalBytes.length })
    expect(readFileSync(kept?.storedPath as string).equals(originalBytes)).toBe(true)
    expect(existsSync(src)).toBe(true)
    expect(statSync(src).size).not.toBe(0)
  })

  it('can be undone: restoring puts the original back and parks the conversion', async () => {
    const src = encode('undo.mp3')
    const originalBytes = readFileSync(src)
    await convertAudio(src, src, 'mp3', meta)
    const kept = (await trash.list()).find((e) => e.originalPath === src)
    const { displaced } = await trash.restore(kept?.id as string)
    expect(readFileSync(src).equals(originalBytes)).toBe(true)
    expect(displaced?.reason).toBe('restored-over')
  })
})

// An in-place export that also renames the file leaves the old path behind; it used to
// be unlinked once the new file was verified in place. Same promise: it goes to the trash.
describe('the original an in-place rename leaves behind', () => {
  it('goes to the trash instead of being unlinked', async () => {
    const src = encode('old-name.mp3')
    const renamed = encode('new-name.mp3')
    await removeRenamedOriginal(src, renamed)
    expect(existsSync(src)).toBe(false)
    const kept = (await trash.list()).find((e) => e.originalPath === src)
    expect(kept).toMatchObject({ reason: 'renamed', outputPath: renamed })
  })
})
