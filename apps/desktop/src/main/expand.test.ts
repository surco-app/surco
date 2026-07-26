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

  it('collects m4a/aac/opus alongside the lossless formats that ffmpeg can decode', async () => {
    // The app integrates with Apple Music (libraries full of .m4a AAC/ALAC) and Bandcamp
    // gives .opus/.ogg; not ingesting them was the gap. ffmpeg decodes them, so they
    // convert like any other input.
    await writeFile(join(dir, 'song.m4a'), '')
    await writeFile(join(dir, 'raw.aac'), '')
    await writeFile(join(dir, 'bandcamp.opus'), '')
    expect((await expandPaths([dir])).sort()).toEqual(
      [join(dir, 'song.m4a'), join(dir, 'raw.aac'), join(dir, 'bandcamp.opus')].sort(),
    )
  })

  // A conversion writes "name.tmp-xxxxxxxx.ext" beside the output and renames it
  // when done. The folder watcher walks with the same collector as imports, so
  // without this skip an in-flight conversion surfaces its own temp as a "new
  // track" — which then vanishes on the rename, leaving a ghost row where every
  // analysis fails (reported from a NAS-watched folder).
  it('never ingests Surco’s own conversion temps, dropped or found', async () => {
    await writeFile(join(dir, 'song.tmp-81f09e8f.wav'), '')
    await writeFile(join(dir, 'song.wav'), '')
    expect(await expandPaths([dir])).toEqual([join(dir, 'song.wav')])
    expect(await expandPaths([join(dir, 'song.tmp-81f09e8f.wav')])).toEqual([])
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

  it('skips a directly-dropped AppleDouble file, not only ones found inside a folder', async () => {
    // Dropping a folder can hand the renderer its child files directly rather than the
    // directory path, so the hidden "._" twin reaches the plain-file branch — it must
    // be filtered there too or the folder drop still doubles every track.
    const real = join(dir, 'track.flac')
    const ghost = join(dir, '._track.flac')
    await writeFile(real, '')
    await writeFile(ghost, '')

    expect(await expandPaths([real, ghost])).toEqual([real])
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

  // The reason this streams at all: on an SMB share a music tree costs one network
  // round trip per directory, so a 560-folder crate takes ~20s to walk while the first
  // audio file is known after ~1s. Reporting files as they are found is what lets the
  // list fill from that first second instead of staying empty until the whole walk ends.
  it('reports files as they are found, before the whole walk finishes', async () => {
    await writeFile(join(dir, 'a.wav'), '')
    await mkdir(join(dir, 'sub'))
    await writeFile(join(dir, 'sub', 'b.flac'), '')

    const seen: string[] = []
    const all = await expandPaths([dir], (batch) => seen.push(...batch))

    // Every path the walk returns must also have been announced — otherwise a consumer
    // driven purely by the callback would silently miss tracks.
    expect(seen.sort()).toEqual(all.sort())
    expect(all.sort()).toEqual([join(dir, 'a.wav'), join(dir, 'sub', 'b.flac')].sort())
  })

  it('announces a shallow file without waiting for a slow sibling directory to finish', async () => {
    // The guarantee that matters on a network volume: a file sitting at the root is
    // usable immediately, even though a sibling subtree is still being walked. If the
    // callback only fired at the end, this would arrive with everything else.
    await writeFile(join(dir, 'quick.wav'), '')
    await mkdir(join(dir, 'deep'))
    await writeFile(join(dir, 'deep', 'slow.flac'), '')

    const order: string[] = []
    await expandPaths([dir], (batch) => order.push(...batch))

    expect(order[0]).toBe(join(dir, 'quick.wav'))
  })

  it('never announces a path it filtered out of the result', async () => {
    // The callback feeds the same import path as the return value, so anything the
    // filters reject (hidden twins, conversion temps, non-audio) must not slip through
    // it — a streamed ghost row is worse than a slow one.
    await writeFile(join(dir, 'track.flac'), '')
    await writeFile(join(dir, '._track.flac'), '')
    await writeFile(join(dir, 'song.tmp-81f09e8f.wav'), '')
    await writeFile(join(dir, 'cover.jpg'), '')

    const seen: string[] = []
    await expandPaths([dir], (batch) => seen.push(...batch))

    expect(seen).toEqual([join(dir, 'track.flac')])
  })
})
