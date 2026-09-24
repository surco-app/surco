import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-music-art-'))
  return { app: { getPath: () => dir } }
})
vi.mock('node:child_process', () => ({
  execFile: (_file: string, _args: string[], _opts: unknown, cb: (err: unknown) => void) =>
    cb(null),
}))

import { app } from 'electron'
import { fetchAppleMusicArtwork } from './appleMusicArtwork'
import { coverThumbPathOf } from './coverThumbs'

const out = mkdtempSync(join(tmpdir(), 'surco-music-art-out-'))
afterAll(() => {
  rmSync(app.getPath('userData'), { recursive: true, force: true })
  rmSync(out, { recursive: true, force: true })
})

// Music's artwork is the full-resolution picture, and a playlist import fetched it for
// every track whose file carries none (half a real library). It used to cross to the
// renderer and sit in each track's state as a base64 data URL; it now travels as a short
// URL to a copy in the thumbnail store, like the files' own embedded covers.
describe('fetchAppleMusicArtwork', () => {
  it('hands each cover that landed over as a short URL to its bytes', async () => {
    const outPath = join(out, 'PID1.jpg')
    writeFileSync(outPath, Buffer.alloc(4000, 5))

    const [cover] = await fetchAppleMusicArtwork([{ persistentId: 'PID1', outPath }])

    expect(cover.path).toBe(outPath)
    expect(cover.url).toMatch(/^surco:\/\/cover\//)
    expect(readFileSync(coverThumbPathOf(cover.url) as string)).toEqual(Buffer.alloc(4000, 5))
  })
})
