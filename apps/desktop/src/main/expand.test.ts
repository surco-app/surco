import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { expandPaths } from './expand'

describe('expandPaths', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'surco-expand-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('replaces a dropped folder with the audio files it contains, recursively', async () => {
    // The whole point: users drop a folder of an album and expect every track in
    // it (including ones nested in subfolders) to load, not nothing.
    await writeFile(join(dir, 'a.wav'), '')
    await mkdir(join(dir, 'sub'))
    await writeFile(join(dir, 'sub', 'b.flac'), '')

    const result = await expandPaths([dir])

    expect(result.sort()).toEqual([join(dir, 'a.wav'), join(dir, 'sub', 'b.flac')].sort())
  })

  it('skips non-audio files inside a dropped folder', async () => {
    // A folder usually holds cover.jpg, notes.txt, etc.; those must not become tracks.
    await writeFile(join(dir, 'song.mp3'), '')
    await writeFile(join(dir, 'cover.jpg'), '')

    expect(await expandPaths([dir])).toEqual([join(dir, 'song.mp3')])
  })

  it('skips macOS AppleDouble companion files so tracks are not doubled', async () => {
    // Copying to USB/exFAT/network drives makes macOS drop a hidden "._track.flac"
    // beside each "track.flac". Finder hides them, but readdir sees them — and their
    // .flac extension would otherwise load them as duplicate tracks carrying the
    // resource-fork bytes as garbage metadata (e.g. artist "._Alberto Añón").
    await writeFile(join(dir, 'track.flac'), '')
    await writeFile(join(dir, '._track.flac'), '')

    expect(await expandPaths([dir])).toEqual([join(dir, 'track.flac')])
  })

  it('passes plain files through untouched so dropping files still works', async () => {
    // Folder support must not regress the existing multi-file drop: a dropped file
    // is returned as-is and left for the renderer to filter.
    const file = join(dir, 'track.aiff')
    await writeFile(file, '')

    expect(await expandPaths([file])).toEqual([file])
  })

  it('ignores paths that no longer exist instead of throwing', async () => {
    expect(await expandPaths([join(dir, 'gone.wav')])).toEqual([])
  })
})
