import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RekordboxPlaylistEdit } from '../shared/types'
import { createRekordboxQueue } from './rekordboxQueue'
import type { EditOp } from './rekordboxQueueOps'
import { applyVirtualdjBatch } from './virtualdjBatch'
import { readVirtualdjLibrary, virtualdjPlaylist } from './virtualdjLibrary'
import { readVirtualdjLists } from './virtualdjLists'
import { applyVirtualdjListOps, virtualdjEditFiles } from './virtualdjListsWrite'

const fixture = join(__dirname, 'virtualdjFixtures')
const LIST_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\r\n<VirtualFolder noDuplicates="no">\r\n'
const FOLDER = readFileSync(join(fixture, 'MyLists', 'Carpeta.vdjfolder'))

function library() {
  const base = mkdtempSync(join(tmpdir(), 'surco-vdj-lists-write-'))
  const dir = join(base, 'VirtualDJ')
  cpSync(fixture, dir, { recursive: true })
  const lists = join(dir, 'MyLists')
  const backupDir = join(base, 'virtualdj-backups')
  const music = join(base, 'Music')
  mkdirSync(music)
  let open = false
  const roots = () => [{ dir, root: '/' }]
  const deps = {
    backupDir,
    roots,
    virtualdjOpen: vi.fn(async () => open),
    ensureClosed: vi.fn(async () => !open),
  }
  const track = (name: string, bytes = 'audio') => {
    const file = join(music, name)
    writeFileSync(file, bytes)
    return file
  }
  const op = (edit: RekordboxPlaylistEdit, id = 'op1'): EditOp => ({
    id,
    kind: 'edit',
    edit,
    stamps: {},
    files: virtualdjEditFiles(edit, roots()),
    label: 'L',
  })
  const run = (edit: RekordboxPlaylistEdit) => applyVirtualdjListOps([op(edit)], deps)
  const at = (rel: string) => join(lists, rel)
  const bytes = (rel: string) => readFileSync(at(rel))
  const text = (rel: string) => readFileSync(at(rel), 'utf8')
  const backups = () =>
    existsSync(join(backupDir, 'lists')) ? readdirSync(join(backupDir, 'lists')) : []
  const links = (id: string) =>
    virtualdjPlaylist(readVirtualdjLibrary(roots()), id).map((e) => e.linkId as string)
  return {
    dir,
    lists,
    deps,
    track,
    op,
    run,
    at,
    bytes,
    text,
    backups,
    links,
    roots,
    setOpen: (v: boolean) => {
      open = v
    },
  }
}

const original = (rel: string) => readFileSync(join(fixture, 'MyLists', rel))

describe('applyVirtualdjListOps', () => {
  it('creates an empty list as VirtualDJ writes one, CRLF, and puts it last in the LF order', async () => {
    const lib = library()
    const result = await lib.run({ kind: 'create', parentId: 'root', name: 'Nueva', folder: false })
    expect(result).toMatchObject({ ok: true, outcomes: [{ applied: true, createdId: 'Nueva' }] })
    expect(lib.text('Nueva.vdjfolder')).toBe(`${LIST_HEAD}</VirtualFolder>\r\n`)
    expect(lib.text('order')).toBe('Carpeta\nSurco prueba\nSurco escrita\nNueva\n')
    expect(readVirtualdjLists(lib.lists).map((n) => n.name)).toEqual([
      'Carpeta',
      'Surco prueba',
      'Surco escrita',
      'Nueva',
    ])
  })

  it('creates a list inside a folder with the pasted tracks, each with its path, size and idx', async () => {
    const lib = library()
    const a = lib.track('a & b.mp3', 'abc')
    const b = lib.track('b.flac', 'abcdef')
    const result = await lib.run({
      kind: 'create',
      parentId: 'Carpeta',
      name: 'Pegada',
      folder: false,
      tracks: [{ paths: [a] }, { paths: ['/old.wav', b] }],
    })
    expect(result).toMatchObject({
      ok: true,
      outcomes: [{ applied: true, createdId: 'Carpeta/Pegada', report: { added: 2 } }],
    })
    expect(lib.text('Carpeta.subfolders/Pegada.vdjfolder')).toBe(
      `${LIST_HEAD}\t<song path="${a.replace('&', '&amp;')}" size="3" idx="0" />\r\n\t<song path="${b}" size="6" idx="1" />\r\n</VirtualFolder>\r\n`,
    )
    expect(lib.text('Carpeta.subfolders/order')).toBe('Dentro\nPegada\n')
    expect(lib.bytes('order')).toEqual(original('order'))
  })

  it('creates a folder as its <VirtualFolder /> file plus a .subfolders directory with its own order', async () => {
    const lib = library()
    const result = await lib.run({ kind: 'create', parentId: 'root', name: 'Sets', folder: true })
    expect(result).toMatchObject({ ok: true, outcomes: [{ applied: true, createdId: 'Sets' }] })
    expect(lib.bytes('Sets.vdjfolder')).toEqual(FOLDER)
    expect(lib.text('Sets.subfolders/order')).toBe('')
    expect(readVirtualdjLists(lib.lists).at(-1)).toMatchObject({
      id: 'Sets',
      kind: 'folder',
      children: [],
    })
  })

  it('refuses a name a Mac file cannot carry or one a sibling already has, writing nothing', async () => {
    const lib = library()
    for (const name of ['a/b', 'a:b', ' ', 'surco PRUEBA']) {
      const result = await lib.run({ kind: 'create', parentId: 'root', name, folder: false })
      expect(result).toMatchObject({ ok: true, outcomes: [{ applied: false, reason: 'bad-name' }] })
    }
    expect(lib.bytes('order')).toEqual(original('order'))
    expect(lib.backups()).toEqual([])
  })

  it('renames a list by renaming its file and its order line, keeping its bytes', async () => {
    const lib = library()
    await lib.run({ kind: 'rename', playlistId: 'Surco prueba', name: 'Renombrada' })
    expect(lib.bytes('Renombrada.vdjfolder')).toEqual(original('Surco prueba.vdjfolder'))
    expect(existsSync(lib.at('Surco prueba.vdjfolder'))).toBe(false)
    expect(lib.text('order')).toBe('Carpeta\nRenombrada\nSurco escrita\n')
  })

  it('renames only the case of a list without losing it on a case-insensitive disk', async () => {
    const lib = library()
    await lib.run({ kind: 'rename', playlistId: 'Surco prueba', name: 'Surco Prueba' })
    expect(readdirSync(lib.lists)).toContain('Surco Prueba.vdjfolder')
    expect(lib.bytes('Surco Prueba.vdjfolder')).toEqual(original('Surco prueba.vdjfolder'))
    expect(lib.text('order')).toBe('Carpeta\nSurco Prueba\nSurco escrita\n')
  })

  it('renames a folder, its .subfolders directory with the lists inside, and its order line', async () => {
    const lib = library()
    await lib.run({ kind: 'rename', playlistId: 'Carpeta', name: 'Cajón' })
    expect(lib.bytes('Cajón.vdjfolder')).toEqual(FOLDER)
    expect(lib.bytes('Cajón.subfolders/Dentro.vdjfolder')).toEqual(
      original('Carpeta.subfolders/Dentro.vdjfolder'),
    )
    expect(lib.bytes('Cajón.subfolders/order')).toEqual(original('Carpeta.subfolders/order'))
    expect(existsSync(lib.at('Carpeta.vdjfolder'))).toBe(false)
    expect(existsSync(lib.at('Carpeta.subfolders'))).toBe(false)
    expect(lib.text('order')).toBe('Cajón\nSurco prueba\nSurco escrita\n')
  })

  it('deletes a list and its order line', async () => {
    const lib = library()
    await lib.run({ kind: 'delete', playlistId: 'Surco escrita' })
    expect(existsSync(lib.at('Surco escrita.vdjfolder'))).toBe(false)
    expect(lib.text('order')).toBe('Carpeta\nSurco prueba\n')
  })

  it('deletes a folder with every list inside it', async () => {
    const lib = library()
    await lib.run({ kind: 'delete', playlistId: 'Carpeta' })
    expect(readdirSync(lib.lists).sort()).toEqual([
      'Surco escrita.vdjfolder',
      'Surco prueba.vdjfolder',
      'order',
    ])
    expect(lib.text('order')).toBe('Surco prueba\nSurco escrita\n')
  })

  it('deletes a folder even when a temp Surco left there after a crash sits inside it', async () => {
    const lib = library()
    writeFileSync(lib.at('Carpeta.subfolders/Dentro.vdjfolder.surco-write'), 'half')
    const result = await lib.run({ kind: 'delete', playlistId: 'Carpeta' })
    expect(result).toMatchObject({ ok: true, outcomes: [{ applied: true }] })
    expect(existsSync(lib.at('Carpeta.subfolders'))).toBe(false)
  })

  it('adds a track at the end with the next idx, keeps the rows already there and counts what it skipped', async () => {
    const lib = library()
    const c = lib.track('c.mp3', 'abcd')
    const result = await lib.run({
      kind: 'add',
      playlistId: 'Surco escrita',
      tracks: [
        { paths: ['/Music/VirtualDJ Pruebas/Pray.flac'] },
        { paths: [c] },
        { paths: ['/nowhere/gone.mp3'] },
      ],
    })
    expect(result).toMatchObject({
      ok: true,
      outcomes: [
        { applied: true, report: { added: 1, already: 1, notInCollection: 1, ambiguous: 0 } },
      ],
    })
    expect(lib.text('Surco escrita.vdjfolder')).toBe(
      original('Surco escrita.vdjfolder')
        .toString()
        .replace('</VirtualFolder>', `\t<song path="${c}" size="4" idx="1" />\r\n</VirtualFolder>`),
    )
  })

  it('removes a row and numbers the rest again, keeping every other attribute', async () => {
    const lib = library()
    const [, flac] = lib.links('Surco prueba')
    await lib.run({ kind: 'remove', playlistId: 'Surco prueba', linkIds: [flac] })
    const lines = original('Surco prueba.vdjfolder').toString().split('\r\n')
    expect(lib.text('Surco prueba.vdjfolder')).toBe(
      [
        lines[0],
        lines[1],
        lines[2],
        lines[4].replace('idx="2"', 'idx="1"'),
        lines[5].replace('idx="3"', 'idx="2"'),
        lines[6].replace('idx="4"', 'idx="3"'),
        lines[7],
        '',
      ].join('\r\n'),
    )
  })

  it('reorders rows by rewriting idx, so VirtualDJ plays them in the new order', async () => {
    const lib = library()
    const links = lib.links('Surco prueba')
    await lib.run({
      kind: 'move',
      playlistId: 'Surco prueba',
      linkIds: [links[4]],
      beforeLinkId: links[0],
    })
    expect(
      virtualdjPlaylist(readVirtualdjLibrary(lib.roots()), 'Surco prueba').map((e) => e.path),
    ).toEqual([
      '/Music/VirtualDJ Pruebas/Pray.wav',
      '/Music/Serato Pruebas/Pray.mp3',
      '/Music/Serato Pruebas/Pray.flac',
      '/Music/VirtualDJ Pruebas/Pray.aiff',
      '/Music/VirtualDJ Pruebas/Pray.m4a',
    ])
    const written = lib.text('Surco prueba.vdjfolder')
    expect(written.split('\r\n')).toHaveLength(9)
    expect(written.replace(/\r\n/g, '')).not.toContain('\n')
    expect([...written.matchAll(/idx="(\d+)"/g)].map((m) => m[1])).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
    ])
  })

  it('refuses a queued folder delete when a list was added inside it in VirtualDJ meanwhile, so that list is not wiped', async () => {
    const lib = library()
    const op = lib.op({ kind: 'delete', playlistId: 'Carpeta' })
    writeFileSync(lib.at('Carpeta.subfolders/Nueva.vdjfolder'), `${LIST_HEAD}</VirtualFolder>\r\n`)
    const result = await applyVirtualdjListOps([op], lib.deps)
    expect(result).toMatchObject({
      ok: true,
      outcomes: [{ applied: false, reason: 'stale', notices: [{ code: 'edit-changed' }] }],
    })
    expect(existsSync(lib.at('Carpeta.subfolders/Nueva.vdjfolder'))).toBe(true)
    expect(lib.bytes('Carpeta.vdjfolder')).toEqual(FOLDER)
  })

  it('refuses a queued folder rename when a list inside it gained tracks in VirtualDJ meanwhile', async () => {
    const lib = library()
    const op = lib.op({ kind: 'rename', playlistId: 'Carpeta', name: 'Otra' })
    const grown = original('Carpeta.subfolders/Dentro.vdjfolder')
      .toString()
      .replace(
        '</VirtualFolder>',
        '\t<song path="/Music/otra.mp3" size="1" idx="1" />\r\n</VirtualFolder>',
      )
    writeFileSync(lib.at('Carpeta.subfolders/Dentro.vdjfolder'), grown)
    const result = await applyVirtualdjListOps([op], lib.deps)
    expect(result).toMatchObject({ ok: true, outcomes: [{ applied: false, reason: 'stale' }] })
    expect(lib.text('Carpeta.subfolders/Dentro.vdjfolder')).toBe(grown)
    expect(existsSync(lib.at('Otra.vdjfolder'))).toBe(false)
  })

  it('refuses a queued list delete or move when the list gained tracks in VirtualDJ meanwhile', async () => {
    const lib = library()
    const ops = [
      lib.op({ kind: 'delete', playlistId: 'Surco escrita' }, 'del'),
      lib.op(
        { kind: 'moveNode', playlistId: 'Surco escrita', parentId: 'Carpeta', beforeId: null },
        'mv',
      ),
    ]
    const grown = original('Surco escrita.vdjfolder')
      .toString()
      .replace(
        '</VirtualFolder>',
        '\t<song path="/Music/otra.mp3" size="1" idx="1" />\r\n</VirtualFolder>',
      )
    writeFileSync(lib.at('Surco escrita.vdjfolder'), grown)
    const result = await applyVirtualdjListOps(ops, lib.deps)
    expect(result).toMatchObject({
      ok: true,
      outcomes: [
        { applied: false, reason: 'stale' },
        { applied: false, reason: 'stale' },
      ],
    })
    expect(lib.text('Surco escrita.vdjfolder')).toBe(grown)
  })

  it('refuses a queued create when VirtualDJ made a list of that name meanwhile', async () => {
    const lib = library()
    const op = lib.op({ kind: 'create', parentId: 'root', name: 'Nueva', folder: false })
    writeFileSync(lib.at('Nueva.vdjfolder'), original('Surco escrita.vdjfolder'))
    const result = await applyVirtualdjListOps([op], lib.deps)
    expect(result).toMatchObject({ ok: true, outcomes: [{ applied: false, reason: 'stale' }] })
    expect(lib.bytes('Nueva.vdjfolder')).toEqual(original('Surco escrita.vdjfolder'))
  })

  it('refuses a row edit on a list that changed in VirtualDJ since it was read, even when the rows it names are still in place', async () => {
    const lib = library()
    const links = lib.links('Surco escrita')
    const op = lib.op({ kind: 'remove', playlistId: 'Surco escrita', linkIds: [links[0]] })
    const added = original('Surco escrita.vdjfolder')
      .toString()
      .replace(
        '</VirtualFolder>',
        '\t<song path="/Music/otra.mp3" size="1" idx="1" />\r\n</VirtualFolder>',
      )
    writeFileSync(lib.at('Surco escrita.vdjfolder'), added)
    const result = await applyVirtualdjListOps([op], lib.deps)
    expect(result).toMatchObject({
      ok: true,
      outcomes: [{ applied: false, reason: 'stale', notices: [{ code: 'edit-changed' }] }],
    })
    expect(lib.text('Surco escrita.vdjfolder')).toBe(added)
  })

  it('refuses to rewrite a list holding anything between its rows that Surco does not know, so nothing in it is lost', async () => {
    const lib = library()
    const odd = `${LIST_HEAD}\t<song path="/a.mp3" idx="0" />\r\n\t<song idx="1" />\r\n\t<song path="/b.mp3" idx="2" />\r\n</VirtualFolder>\r\n`
    writeFileSync(lib.at('Surco escrita.vdjfolder'), odd)
    const [first] = lib.links('Surco escrita')
    const result = await lib.run({ kind: 'remove', playlistId: 'Surco escrita', linkIds: [first] })
    expect(result).toMatchObject({ ok: true, outcomes: [{ applied: false, reason: 'unreadable' }] })
    expect(lib.text('Surco escrita.vdjfolder')).toBe(odd)
  })

  it('moves a list into a folder before a sibling, in both order files', async () => {
    const lib = library()
    await lib.run({
      kind: 'moveNode',
      playlistId: 'Surco escrita',
      parentId: 'Carpeta',
      beforeId: 'Carpeta/Dentro',
    })
    expect(lib.bytes('Carpeta.subfolders/Surco escrita.vdjfolder')).toEqual(
      original('Surco escrita.vdjfolder'),
    )
    expect(existsSync(lib.at('Surco escrita.vdjfolder'))).toBe(false)
    expect(lib.text('Carpeta.subfolders/order')).toBe('Surco escrita\nDentro\n')
    expect(lib.text('order')).toBe('Carpeta\nSurco prueba\n')
  })

  it('reorders lists in the same folder by their order lines alone', async () => {
    const lib = library()
    await lib.run({
      kind: 'moveNode',
      playlistId: 'Surco escrita',
      parentId: 'root',
      beforeId: 'Carpeta',
    })
    expect(lib.text('order')).toBe('Surco escrita\nCarpeta\nSurco prueba\n')
    expect(lib.bytes('Surco escrita.vdjfolder')).toEqual(original('Surco escrita.vdjfolder'))
  })

  it('leaves every list it did not change byte for byte as VirtualDJ wrote it', async () => {
    const lib = library()
    await lib.run({
      kind: 'add',
      playlistId: 'Surco escrita',
      tracks: [{ paths: [lib.track('x.mp3')] }],
    })
    for (const rel of [
      'Surco prueba.vdjfolder',
      'Carpeta.vdjfolder',
      'Carpeta.subfolders/Dentro.vdjfolder',
      'Carpeta.subfolders/order',
      'order',
    ])
      expect(lib.bytes(rel)).toEqual(original(rel))
  })

  it('copies MyLists to the VirtualDJ backups before it writes', async () => {
    const lib = library()
    await lib.run({ kind: 'delete', playlistId: 'Carpeta' })
    const [folder] = lib.backups()
    const copy = join(lib.deps.backupDir, 'lists', folder, 'Local', 'MyLists')
    expect(readFileSync(join(copy, 'Carpeta.subfolders', 'Dentro.vdjfolder'))).toEqual(
      original('Carpeta.subfolders/Dentro.vdjfolder'),
    )
    expect(readFileSync(join(copy, 'order'))).toEqual(original('order'))
  })

  it('keeps the MyLists copies in their own 20, so a run of list edits never pushes out the database copies', async () => {
    const lib = library()
    const database = join(lib.deps.backupDir, '2026-01-01T00-00-00-000Z')
    mkdirSync(join(database, 'Local'), { recursive: true })
    writeFileSync(join(database, 'Local', 'database.xml'), 'copy')
    for (let i = 0; i < 22; i++)
      await lib.run({
        kind: 'moveNode',
        playlistId: 'Surco escrita',
        parentId: 'root',
        beforeId: i % 2 === 0 ? 'Carpeta' : null,
      })
    expect(readFileSync(join(database, 'Local', 'database.xml'), 'utf8')).toBe('copy')
    expect(lib.backups()).toHaveLength(20)
  })

  it('puts every file and folder back when VirtualDJ opens partway through a folder rename', async () => {
    const lib = library()
    const open = lib.deps.virtualdjOpen
    for (let i = 0; i < 6; i++) open.mockResolvedValueOnce(false)
    open.mockResolvedValue(true)
    const result = await lib.run({ kind: 'rename', playlistId: 'Carpeta', name: 'Otra' })
    expect(result).toEqual({ ok: false, reason: 'cancelled' })
    expect(open).toHaveBeenCalledTimes(7)
    const tree = (root: string) =>
      (readdirSync(root, { recursive: true }) as string[]).sort().map((rel) => {
        const path = join(root, rel)
        return [rel, statSync(path).isDirectory() ? 'dir' : readFileSync(path)]
      })
    expect(tree(lib.lists)).toEqual(tree(join(fixture, 'MyLists')))
  })

  it('writes nothing when VirtualDJ opens after the backup, right before the rename', async () => {
    const lib = library()
    lib.deps.virtualdjOpen.mockResolvedValueOnce(false).mockResolvedValue(true)
    const result = await lib.run({ kind: 'rename', playlistId: 'Carpeta', name: 'Otra' })
    expect(result).toEqual({ ok: false, reason: 'cancelled' })
    expect(readdirSync(lib.lists).sort()).toEqual(readdirSync(join(fixture, 'MyLists')).sort())
    expect(lib.bytes('order')).toEqual(original('order'))
    expect(lib.bytes('Carpeta.subfolders/Dentro.vdjfolder')).toEqual(
      original('Carpeta.subfolders/Dentro.vdjfolder'),
    )
  })
})

describe('the VirtualDJ list queue', () => {
  function queued() {
    const lib = library()
    const queue = createRekordboxQueue({
      store: { read: () => null, write: () => {}, setAside: () => {} },
      collection: () => lib.dir,
      applyBatch: (_c, ops, ensureClosed, stillQueued) =>
        applyVirtualdjBatch(ops, { ...lib.deps, ensureClosed, stillQueued }),
      repoint: async () => [],
      nodeStamps: async () => ({}),
      onChange: () => {},
      addsTracks: false,
    })
    return { ...lib, queue }
  }

  it('waits while VirtualDJ is open and writes the list once it closes', async () => {
    const lib = queued()
    lib.setOpen(true)
    lib.queue.enqueue([lib.op({ kind: 'create', parentId: 'root', name: 'Luego', folder: false })])
    expect(await lib.queue.apply(async () => false)).toEqual({
      status: 'refused',
      reason: 'cancelled',
    })
    expect(existsSync(lib.at('Luego.vdjfolder'))).toBe(false)
    expect(lib.queue.isEmpty()).toBe(false)
    lib.setOpen(false)
    expect(await lib.queue.apply(async () => true)).toMatchObject({ status: 'applied' })
    expect(existsSync(lib.at('Luego.vdjfolder'))).toBe(true)
    expect(lib.queue.isEmpty()).toBe(true)
    expect(lib.backups()).toHaveLength(1)
  })
})
