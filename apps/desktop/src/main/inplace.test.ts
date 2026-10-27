import { access, link, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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
import { configureOriginalKeeper } from './originalKeeper'

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

  // outputName is built from a template filled with tag values (artist, album…),
  // which can come from Discogs metadata or a hand-edited field — untrusted text
  // that reaches resolveOutputTarget's join(outputDir, name). A ".." segment
  // would let a crafted tag walk the write target out of outputDir entirely
  // (and removeRenamedOriginal would then delete whatever it clobbered).
  it('strips ".." segments so a crafted tag can\'t escape the output folder', () => {
    expect(sanitizeOutputName('../../etc/passwd')).toBe('etc/passwd')
    expect(sanitizeOutputName('Artist/../../Title')).toBe('Artist/Title')
  })

  it('strips a bare "." segment too, same as an empty one', () => {
    expect(sanitizeOutputName('./Artist/./Title')).toBe('Artist/Title')
  })

  // Libraries live on NAS shares that Windows and macOS machines both open, so a name
  // has to be one Windows can hold whichever system wrote it. Windows silently drops a
  // trailing dot or space, so "Vol." written from a Mac shows up mangled there, and the
  // rename into "Vol." on Windows lands on "Vol" instead, a different file.
  it('drops trailing dots and spaces from every folder segment', () => {
    expect(sanitizeOutputName('Mr. Oizo./Vol. 2 ./Flat Beat')).toBe('Mr. Oizo/Vol. 2/Flat Beat')
  })

  // The last segment is the name before the extension, so its trailing dot is never the
  // end of the file name and Windows keeps it. Dropping it renamed "Still D.R.E..aiff"
  // to "Still D.R.E.aiff" on the next in-place update of a file that was fine.
  it('keeps the trailing dot of the file name, which the extension follows', () => {
    expect(sanitizeOutputName('Dr. Dre/Still D.R.E.')).toBe('Dr. Dre/Still D.R.E.')
  })

  // An update that keeps the file's name asks for the name it already has: that name is
  // on disk, so it is not one to fix. Applied anyway, the rules renamed it ("Aux.wav" to
  // "Aux_.wav", a long Japanese name cut short) and moved the original to the backups,
  // breaking the path every DJ library and playlist held for it.
  it('leaves the name a file already has alone', () => {
    const japanese = 'ガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ'.repeat(3)
    expect(sanitizeOutputName('Aux', 'Aux')).toBe('Aux')
    expect(sanitizeOutputName(japanese, japanese.normalize('NFD'))).toBe(japanese)
    expect(sanitizeOutputName('Aux', 'Song')).toBe('Aux_')
  })

  // The base rules too: "?" and a double space were fine on the disk that holds the file,
  // yet "Where's Your Head At?" came back "Where's Your Head At-", a new name, so the
  // update moved the original to the backups and rekordbox and Traktor lost the track.
  it('keeps the characters and spacing of a name the file already has', () => {
    expect(sanitizeOutputName("Where's Your Head At?", "Where's Your Head At?")).toBe(
      "Where's Your Head At?",
    )
    expect(sanitizeOutputName('Basement  Jaxx: Red Alert', 'Basement  Jaxx: Red Alert')).toBe(
      'Basement  Jaxx: Red Alert',
    )
  })

  // CON, NUL, COM1… name devices on Windows, with or without an extension: a track
  // titled "Con" cannot be written there at all, and "nul.aiff" is swallowed.
  it('steps around the device names Windows reserves, in any case', () => {
    expect(sanitizeOutputName('Con')).toBe('Con_')
    expect(sanitizeOutputName('AUX/nul.remix')).toBe('AUX_/nul_.remix')
    expect(sanitizeOutputName('com1/LPT9')).toBe('com1_/LPT9_')
    expect(sanitizeOutputName('Console/Nullset/COM10')).toBe('Console/Nullset/COM10')
  })

  // Control characters are illegal in Windows names and invisible everywhere else; a
  // pasted tag can carry them. Whitespace ones still read as a space.
  it('replaces control characters', () => {
    expect(sanitizeOutputName(`A${String.fromCharCode(0)}B${String.fromCharCode(31)}C\tD`)).toBe(
      'A-B-C D',
    )
  })

  // 255 bytes is the most a name can hold, and the temp the conversion writes first is
  // the name plus a dot, ".tmp-xxxxxxxx" and the extension. Measured decomposed, since
  // macOS spells accents that way on disk and each one then takes a byte more.
  it('caps a segment so its temp name still fits in 255 bytes', () => {
    const long = sanitizeOutputName(`${'é'.repeat(200)}/${'a'.repeat(300)}`)
    const [dir, file] = long.split('/')
    expect(Buffer.byteLength(dir.normalize('NFD'))).toBeLessThanOrEqual(230)
    expect(Buffer.byteLength(file)).toBeLessThanOrEqual(230)
    expect(Buffer.byteLength(`.${file}.tmp-a1b2c3d4.aiff`)).toBeLessThanOrEqual(255)
  })
})

describe('resolveOutputTarget', () => {
  // ALAC's extension is its container: a conversion into it lands as a fresh .m4a.
  it('renders an ALAC target as a fresh .m4a in the output folder', () => {
    expect(resolveOutputTarget('/music/song.flac', 'Artist - Title', 'alac', '/out')).toEqual({
      outputPath: '/out/Artist - Title.m4a',
      inPlace: false,
    })
  })

  // An .m4a kept in its container is a tag update, AAC or ALAC: it is edited where the
  // user keeps it, like any same-format export, instead of copied to the output folder.
  it('edits an .m4a source in its own folder when the target is its container', () => {
    expect(resolveOutputTarget('/music/song.m4a', 'Artist - Title', 'alac', '/out')).toEqual({
      outputPath: '/music/Artist - Title.m4a',
      inPlace: true,
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

  // Overwrite mode never forces an ALAC conversion over another format's file: it
  // renders a fresh file in the output folder and the source is kept.
  it('never overwrites another format in place for ALAC, even with overwrite on', () => {
    expect(resolveOutputTarget('/music/song.wav', 'song', 'alac', '/out', true)).toEqual({
      outputPath: '/out/song.m4a',
      inPlace: false,
    })
  })

  // sanitizeOutputName is the primary defense against a crafted tag walking the
  // write target out of outputDir — this is defense in depth for the case that
  // guard is ever bypassed or a future caller forgets it: resolveOutputTarget
  // itself refuses to hand back a path outside outputDir.
  it('refuses a name that would resolve outside outputDir even if unsanitized', () => {
    expect(() =>
      resolveOutputTarget('/music/song.wav', '../../etc/passwd', 'flac', '/out'),
    ).toThrow()
  })

  // The "beside the original" destination: a fresh file in the source's own folder,
  // never an in-place rewrite — inPlace false is what keeps removeRenamedOriginal
  // from ever unlinking the source, whatever the format.
  describe('beside-original mode', () => {
    it('lands a conversion next to the source, original kept', () => {
      expect(resolveOutputTarget('/music/old.wav', 'old', 'flac', '/out', false, true)).toEqual({
        outputPath: '/music/old.flac',
        inPlace: false,
      })
    })

    it('is never in place, even when the format matches the source', () => {
      // Same extension resolves to the source's own path here; the caller bumps it to
      // "old (2).wav" — what matters is inPlace false so the original survives.
      expect(resolveOutputTarget('/music/old.wav', 'old', 'wav', '/out', false, true)).toEqual({
        outputPath: '/music/old.wav',
        inPlace: false,
      })
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

  it('finishes when the keeper already sent the original to the system trash', async () => {
    dir = await mkdtemp(join(tmpdir(), 'surco-rm-'))
    const oldPath = join(dir, 'old.mp3')
    const newPath = join(dir, 'old.aiff')
    await writeFile(oldPath, 'a')
    await writeFile(newPath, 'b')
    configureOriginalKeeper(async (path) => {
      await rm(path)
      return null
    })
    try {
      await removeRenamedOriginal(oldPath, newPath)
    } finally {
      configureOriginalKeeper(null)
    }

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

  // The hard-link case above can't fail: unlinking one of two directory entries always
  // leaves the other, so it passes with the inode guard removed. This is the real
  // shape of the bug — one directory entry reached through two casings, where the
  // unlink targets the very entry holding the converted audio. Skipped rather than
  // faked on case-sensitive volumes (Linux CI), where the premise cannot exist.
  it('keeps the converted audio when a case-only rename resolves to one file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'surco-rm-'))
    const upper = join(dir, 'Song.WAV')
    const lower = join(dir, 'song.wav')
    await writeFile(upper, 'converted audio')
    if (!(await exists(lower))) return

    // convertAudio wrote through the new casing; the old one names the same bytes.
    await removeRenamedOriginal(upper, lower)

    expect(await readdir(dir)).toHaveLength(1)
    expect(await readFile(lower, 'utf-8')).toBe('converted audio')
  })
})
