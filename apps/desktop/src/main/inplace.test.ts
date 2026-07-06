import { access, link, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isOutputConflict,
  isSameFile,
  removeRenamedOriginal,
  resolveOutputTarget,
  sanitizeOutputName,
  uniqueOutputPath,
} from './inplace'

describe('sanitizeOutputName', () => {
  it('keeps "/" as a folder boundary while cleaning each segment on its own', () => {
    expect(sanitizeOutputName('Various/Hard House/01 Snap')).toBe('Various/Hard House/01 Snap')
  })

  it('replaces filesystem-illegal characters inside a segment, not the separators', () => {
    expect(sanitizeOutputName('AC:DC/T*NT?')).toBe('AC-DC/T-NT-')
  })

  it('drops empty segments so a blank leading field makes no stray "" directory', () => {
    expect(sanitizeOutputName('/Hard House/01 Snap')).toBe('Hard House/01 Snap')
    expect(sanitizeOutputName('A//B')).toBe('A/B')
  })

  it('supports arbitrary folder depth', () => {
    expect(sanitizeOutputName('a/b/c/d/e')).toBe('a/b/c/d/e')
  })
})

describe('resolveOutputTarget', () => {
  // ALAC's extension is its container: the output must land as .m4a, and never in
  // place — a same-extension .m4a source might be lossy AAC the re-encode would replace.
  it('renders an ALAC target as a fresh .m4a in the output folder', () => {
    expect(resolveOutputTarget('/music/song.m4a', 'Artist - Title', 'alac', '/out')).toEqual({
      outputPath: '/out/Artist - Title.m4a',
      inPlace: false,
    })
  })

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

  it('overwrites in the source folder even across formats when overwrite is on', () => {
    // With "Overwrite original" the converted file replaces the source where it lives,
    // keeping the source's base name; the new extension means convertAudio writes
    // old.aiff and removeRenamedOriginal drops the old.wav. The output folder is ignored.
    expect(resolveOutputTarget('/music/old.wav', 'old', 'aiff', '/out', true)).toEqual({
      outputPath: '/music/old.aiff',
      inPlace: true,
    })
  })

  // Overwrite mode must not break ALAC's never-in-place invariant: an .m4a source may
  // hold lossy AAC, and forcing in place would re-encode it over itself — the original
  // destroyed and a lossy encode presented as lossless. ALAC always renders a fresh
  // file in the output folder and the source is kept.
  it('never overwrites in place for ALAC, even with overwrite on', () => {
    expect(resolveOutputTarget('/music/song.m4a', 'song', 'alac', '/out', true)).toEqual({
      outputPath: '/out/song.m4a',
      inPlace: false,
    })
  })
})

describe('isOutputConflict', () => {
  // The danger we're guarding against: a conversion silently overwriting an
  // unrelated file that already sits at the target path.
  it('flags an existing target that a fresh conversion would clobber', () => {
    expect(isOutputConflict('/out/song.mp3', undefined, true, false)).toBe(true)
  })

  it('is not a conflict when no file sits at the target', () => {
    expect(isOutputConflict('/out/song.mp3', undefined, false, false)).toBe(false)
  })

  // Re-exporting a track replaces the file the same track produced before — that's
  // the intended overwrite, not a collision, so it must not prompt.
  it('is not a conflict when the target is this track’s own previous output', () => {
    expect(isOutputConflict('/out/song.mp3', '/out/song.mp3', true, false)).toBe(false)
  })

  // An in-place edit that RENAMES can land on an unrelated neighbour ("track.mp3"
  // beside the "track (copy).mp3" being edited) — that clobber then chains into
  // removeRenamedOriginal deleting the source, so it must prompt like any other.
  it('flags an in-place rename landing on an existing unrelated file', () => {
    expect(isOutputConflict('/music/track.mp3', undefined, true, false)).toBe(true)
  })

  // The one legitimate "target exists" for in-place: the target IS the source being
  // rewritten (same name, or a case-only rename the volume resolves to one file).
  it('is not a conflict when the target is the source file itself', () => {
    expect(isOutputConflict('/music/song.wav', undefined, true, true)).toBe(false)
  })
})

describe('isSameFile', () => {
  let dir: string

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('is true for the identical path without touching the filesystem', async () => {
    dir = await mkdtemp(join(tmpdir(), 'surco-same-'))
    expect(await isSameFile('/nowhere/song.wav', '/nowhere/song.wav')).toBe(true)
  })

  // A case-only in-place rename (Song.WAV → song.wav) resolves to one file on the
  // case-insensitive volumes Surco runs on; a hard link models one-inode-two-names.
  it('is true for two names of the same inode', async () => {
    dir = await mkdtemp(join(tmpdir(), 'surco-same-'))
    const real = join(dir, 'song.wav')
    const alias = join(dir, 'song-alias.wav')
    await writeFile(real, 'a')
    await link(real, alias)
    expect(await isSameFile(real, alias)).toBe(true)
  })

  it('is false for two distinct files, and false when either side is missing', async () => {
    dir = await mkdtemp(join(tmpdir(), 'surco-same-'))
    const a = join(dir, 'a.wav')
    const b = join(dir, 'b.wav')
    await writeFile(a, 'a')
    await writeFile(b, 'b')
    expect(await isSameFile(a, b)).toBe(false)
    expect(await isSameFile(a, join(dir, 'missing.wav'))).toBe(false)
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
