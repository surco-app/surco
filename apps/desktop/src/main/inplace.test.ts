import { access, link, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isOutputConflict,
  removeRenamedOriginal,
  resolveOutputTarget,
  uniqueOutputPath,
} from './inplace'

describe('resolveOutputTarget', () => {
  it('edits the original in its own folder when the format matches the source', () => {
    // Exporting a WAV to WAV is a tag-only rewrite, so there is no reason to spawn
    // a copy in the output folder — the file is updated where the user keeps it.
    expect(resolveOutputTarget('/music/old.wav', 'ATB - Till I Come', 'wav', '/out')).toEqual({
      outputPath: '/music/ATB - Till I Come.wav',
      inPlace: true,
    })
  })

  it('writes a fresh file to the output folder when converting to a different format', () => {
    // WAV→MP3 re-encodes into a new container, so it lands in the configured output
    // folder and the original is left untouched (inPlace false).
    expect(resolveOutputTarget('/music/old.wav', 'ATB - Till I Come', 'mp3', '/out')).toEqual({
      outputPath: '/out/ATB - Till I Come.mp3',
      inPlace: false,
    })
  })
})

describe('isOutputConflict', () => {
  // The danger we're guarding against: a real conversion silently overwriting an
  // unrelated file that already sits at the target path.
  it('flags an existing target that a fresh conversion would clobber', () => {
    expect(isOutputConflict('/out/song.mp3', undefined, false, true)).toBe(true)
  })

  it('is not a conflict when no file sits at the target', () => {
    expect(isOutputConflict('/out/song.mp3', undefined, false, false)).toBe(false)
  })

  // Re-exporting a track replaces the file the same track produced before — that's
  // the intended overwrite, not a collision, so it must not prompt.
  it('is not a conflict when the target is this track’s own previous output', () => {
    expect(isOutputConflict('/out/song.mp3', '/out/song.mp3', false, true)).toBe(false)
  })

  // In-place edits rewrite the source itself (and removeRenamedOriginal handles the
  // old name); that path always "exists" by definition and is never a collision.
  it('is never a conflict for an in-place edit', () => {
    expect(isOutputConflict('/music/song.wav', undefined, true, true)).toBe(false)
  })
})

describe('uniqueOutputPath', () => {
  it('returns the path unchanged when nothing is there', () => {
    expect(uniqueOutputPath('/out/song.mp3', () => false)).toBe('/out/song.mp3')
  })

  it('appends the first free " (n)" suffix, keeping the extension', () => {
    const taken = new Set(['/out/song.mp3', '/out/song (2).mp3'])
    expect(uniqueOutputPath('/out/song.mp3', (p) => taken.has(p))).toBe('/out/song (3).mp3')
  })
})

describe('removeRenamedOriginal', () => {
  let dir: string

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const exists = (p: string): Promise<boolean> =>
    access(p).then(
      () => true,
      () => false,
    )

  it('deletes the original when the rename left it behind as a separate file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'surco-rm-'))
    const oldPath = join(dir, 'old.wav')
    const newPath = join(dir, 'new.wav')
    await writeFile(oldPath, 'a')
    await writeFile(newPath, 'b')

    await removeRenamedOriginal(oldPath, newPath)

    expect(await exists(oldPath)).toBe(false)
    expect(await exists(newPath)).toBe(true)
  })

  it('does nothing when input and output are the same path', async () => {
    dir = await mkdtemp(join(tmpdir(), 'surco-rm-'))
    const path = join(dir, 'song.wav')
    await writeFile(path, 'a')

    await removeRenamedOriginal(path, path)

    expect(await exists(path)).toBe(true)
  })

  it('never deletes the file it just wrote when the two paths are the same inode', async () => {
    // The danger case on case-insensitive volumes: a "rename" of Song.WAV → Song.wav
    // resolves to one file, so the old and new paths share a device+inode. A hard
    // link models that one-inode-two-names situation (we can't create both casings
    // on a case-insensitive volume), and the guard must keep the file rather than
    // unlink the very bytes it just wrote.
    dir = await mkdtemp(join(tmpdir(), 'surco-rm-'))
    const real = join(dir, 'song.wav')
    const alias = join(dir, 'song-same-inode.wav')
    await writeFile(real, 'a')
    await link(real, alias)

    await removeRenamedOriginal(alias, real)

    expect(await exists(real)).toBe(true)
    expect(await readdir(dir)).toContain('song.wav')
  })
})
