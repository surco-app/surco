import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseVirtualdjDatabase } from './virtualdjDatabase'
import { replaceVirtualdjDuplicates } from './virtualdjDuplicates'
import { readVirtualdjLibrary, virtualdjLibraryRoots, virtualdjPlaylist } from './virtualdjLibrary'

const fixture = join(__dirname, 'virtualdjFixtures')
const FIXTURE_XML = readFileSync(join(fixture, 'database.xml'), 'utf8')
const FROM = '/Music/Serato Pruebas/Pray.mp3'
const WAV = '/Music/VirtualDJ Pruebas/Pray.wav'

function songBlock(xml: string, path: string): string {
  const at = xml.indexOf(`<Song FilePath="${path}"`)
  return xml.slice(at, xml.indexOf('</Song>', at))
}

function library() {
  const base = mkdtempSync(join(tmpdir(), 'surco-vdj-duplicates-'))
  const dir = join(base, 'VirtualDJ')
  cpSync(fixture, dir, { recursive: true })
  const volumes = join(base, 'Volumes')
  mkdirSync(volumes)
  const kept = join(base, 'Pray.aiff')
  writeFileSync(kept, 'aiffdata')
  let open = false
  const roots = () => virtualdjLibraryRoots(dir, volumes)
  const deps = {
    backupDir: join(base, 'virtualdj-backups'),
    roots,
    virtualdjOpen: vi.fn(async () => open),
  }
  const database = () => readFileSync(join(dir, 'database.xml'), 'utf8')
  const list = (id: string) =>
    virtualdjPlaylist(readVirtualdjLibrary(roots()), id).map((entry) => entry.path)
  return {
    base,
    dir,
    volumes,
    kept,
    deps,
    database,
    list,
    setOpen: (v: boolean) => {
      open = v
    },
  }
}

describe('replaceVirtualdjDuplicates', () => {
  it('moves the removed copy’s song, cues and all, to the kept file VirtualDJ never had, and its list rows with it', async () => {
    const lib = library()
    const before = songBlock(FIXTURE_XML, FROM)
    expect(await replaceVirtualdjDuplicates([{ from: FROM, to: lib.kept }], lib.deps)).toEqual([
      { written: true, outcome: 'repointed' },
    ])
    const xml = lib.database()
    expect(xml).not.toContain(`FilePath="${FROM}"`)
    expect(songBlock(xml, lib.kept)).toBe(
      before
        .replace(`FilePath="${FROM}" FileSize="17138984"`, `FilePath="${lib.kept}" FileSize="8"`)
        .replace(' Bitrate="320"', ''),
    )
    expect(lib.list('Surco prueba')[0]).toBe(lib.kept)
    expect(lib.list('Carpeta/Dentro')).toContain(lib.kept)
    expect(lib.list('Carpeta/Dentro')).not.toContain(FROM)
  })

  it('gives the moved song the kept file’s bitrate and keeps its length, as a conversion move does without a decoded length', async () => {
    const lib = library()
    const audioOf = vi.fn(async () => ({ bitrateKbps: 1411 }))
    await replaceVirtualdjDuplicates([{ from: FROM, to: lib.kept }], { ...lib.deps, audioOf })
    expect(audioOf).toHaveBeenCalledWith(lib.kept)
    const infos = songBlock(lib.database(), lib.kept).split('\r\n')[2]
    expect(infos).toBe(
      songBlock(FIXTURE_XML, FROM).split('\r\n')[2].replace('Bitrate="320"', 'Bitrate="1411"'),
    )
  })

  it('drops the removed copy’s bitrate when the kept file’s cannot be told, so VirtualDJ reads it again', async () => {
    const lib = library()
    await replaceVirtualdjDuplicates([{ from: FROM, to: lib.kept }], {
      ...lib.deps,
      audioOf: async () => ({}),
    })
    const infos = songBlock(lib.database(), lib.kept).split('\r\n')[2]
    expect(infos).toBe(songBlock(FIXTURE_XML, FROM).split('\r\n')[2].replace(' Bitrate="320"', ''))
  })

  it('drops the removed copy’s song when the kept file has its own, and its list rows go to the kept copy', async () => {
    const lib = library()
    const withKept = FIXTURE_XML.replace(`FilePath="${WAV}"`, `FilePath="${lib.kept}"`)
    writeFileSync(join(lib.dir, 'database.xml'), withKept)
    expect(await replaceVirtualdjDuplicates([{ from: FROM, to: lib.kept }], lib.deps)).toEqual([
      { written: true, outcome: 'replaced' },
    ])
    const xml = lib.database()
    const start = withKept.indexOf(`<Song FilePath="${FROM}"`)
    const block = withKept.slice(
      withKept.lastIndexOf('\r\n', start) + 2,
      withKept.indexOf('\r\n', withKept.indexOf('</Song>', start)) + 2,
    )
    expect(block.trimEnd().endsWith('</Song>')).toBe(true)
    expect(xml).toBe(withKept.replace(block, ''))
    expect(parseVirtualdjDatabase(xml)).toHaveLength(parseVirtualdjDatabase(withKept).length - 1)
    expect(lib.list('Surco prueba')[0]).toBe(lib.kept)
  })

  it('drops the removed copy’s row from a list that already holds the kept copy, so the list never shows the track twice', async () => {
    const lib = library()
    writeFileSync(
      join(lib.dir, 'database.xml'),
      FIXTURE_XML.replace(`FilePath="${WAV}"`, `FilePath="${lib.kept}"`),
    )
    const file = join(lib.dir, 'MyLists', 'Surco prueba.vdjfolder')
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replaceAll(`path="${WAV}"`, `path="${lib.kept}"`),
    )
    const others = lib.list('Surco prueba').filter((p) => p !== FROM && p !== lib.kept)
    expect(await replaceVirtualdjDuplicates([{ from: FROM, to: lib.kept }], lib.deps)).toEqual([
      { written: true, outcome: 'replaced' },
    ])
    expect(lib.list('Surco prueba').filter((p) => p === lib.kept)).toHaveLength(1)
    expect(lib.list('Surco prueba')).not.toContain(FROM)
    expect(lib.list('Surco prueba').filter((p) => p !== lib.kept)).toEqual(others)
    expect(lib.list('Carpeta/Dentro')).toEqual([lib.kept])
  })

  it('leaves VirtualDJ as it is while it is open, so the removed file stays for it', async () => {
    const lib = library()
    lib.setOpen(true)
    expect(await replaceVirtualdjDuplicates([{ from: FROM, to: lib.kept }], lib.deps)).toEqual([
      { written: false, reason: 'virtualdj-running' },
    ])
    expect(lib.database()).toBe(FIXTURE_XML)
  })

  it('says it never had a copy VirtualDJ does not know, and writes nothing', async () => {
    const lib = library()
    expect(
      await replaceVirtualdjDuplicates([{ from: '/Music/Other.mp3', to: lib.kept }], lib.deps),
    ).toEqual([{ written: false, reason: 'no-match' }])
    expect(lib.database()).toBe(FIXTURE_XML)
  })

  it('refuses to move a song onto a kept copy on another disk, leaving the song and its rows', async () => {
    const lib = library()
    const volume = join(lib.volumes, 'Public')
    mkdirSync(join(volume, 'VirtualDJ'), { recursive: true })
    writeFileSync(
      join(volume, 'VirtualDJ', 'database.xml'),
      '<?xml version="1.0" encoding="UTF-8"?>\r\n<VirtualDJ_Database Version="2026">\r\n</VirtualDJ_Database>\r\n',
    )
    const elsewhere = join(volume, 'Pray.aiff')
    writeFileSync(elsewhere, 'abcd')
    expect(await replaceVirtualdjDuplicates([{ from: FROM, to: elsewhere }], lib.deps)).toEqual([
      { written: false, reason: 'other-volume' },
    ])
    expect(lib.database()).toBe(FIXTURE_XML)
    expect(lib.list('Surco prueba')[0]).toBe(FROM)
  })
})
