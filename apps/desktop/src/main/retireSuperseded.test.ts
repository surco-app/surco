import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import initSqlJs from 'sql.js'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { djLibraryFileUse, type LibraryLocations } from './libraryFileUse'
import { REKORDBOX_KEY } from './rekordboxDb'
import { type RetireDeps, retireSuperseded } from './retireSuperseded'

const NONE: LibraryLocations = { rekordbox: '', engine: '', traktor: '', serato: [], virtualdj: [] }
let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'surco-retire-'))
})

async function rekordboxWith(folderPath: string): Promise<string> {
  const path = join(root, `master-${Math.random().toString(36).slice(2)}.db`)
  const db = new Database(path)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('legacy=4')
  db.pragma(`key='${REKORDBOX_KEY}'`)
  db.exec(`CREATE TABLE djmdContent (
    ID VARCHAR(255) PRIMARY KEY, FolderPath VARCHAR(255), FileNameL VARCHAR(255),
    FileType INTEGER, FileSize INTEGER, rb_local_deleted TINYINT(1) DEFAULT 0
  )`)
  db.prepare(
    'INSERT INTO djmdContent (ID, FolderPath, FileNameL, FileType, FileSize) VALUES (?, ?, ?, 1, 10)',
  ).run('1', folderPath, folderPath.slice(folderPath.lastIndexOf('/') + 1))
  db.close()
  return path
}

async function engineWith(stored: string): Promise<string> {
  const require = createRequire(import.meta.url)
  const buf = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'))
  const SQL = await initSqlJs({
    wasmBinary: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  })
  const dir = join(root, `Engine-${Math.random().toString(36).slice(2)}`, 'Engine Library')
  await mkdir(join(dir, 'Database2'), { recursive: true })
  const db = new SQL.Database()
  db.run('CREATE TABLE Track (id INTEGER PRIMARY KEY, path TEXT)')
  db.run('INSERT INTO Track (id, path) VALUES (1, ?)', [stored])
  await writeFile(join(dir, 'Database2', 'm.db'), db.export())
  return dir
}

async function traktorWith(volume: string, dir: string, file: string): Promise<string> {
  const path = join(root, `collection-${Math.random().toString(36).slice(2)}.nml`)
  await writeFile(
    path,
    `<NML><COLLECTION ENTRIES="1"><ENTRY TITLE="X"><LOCATION DIR="${dir}" FILE="${file}" VOLUME="${volume}"></LOCATION></ENTRY></COLLECTION></NML>`,
  )
  return path
}

function setup(libraries: LibraryLocations, over: Partial<RetireDeps> = {}) {
  const trash = vi.fn<RetireDeps['trash']>(async () => undefined)
  const deps: RetireDeps = {
    usedByLibrary: djLibraryFileUse(libraries, { realPath: (p) => p }),
    exists: () => true,
    keepsTrash: () => true,
    policy: () => 'audioChanges',
    trash,
    ...over,
  }
  return { deps, trash }
}

describe('retireSuperseded', () => {
  it('keeps the replaced Music copy Traktor still plays, though the check was ok (A: a download converted over the Music copy, Traktor never patched)', async () => {
    const old = '/Volumes/Public/Music/Media.localized/Music/T/A/A.mp3'
    const traktor = await traktorWith('Public', '/:Music/:Media.localized/:Music/:T/:A/:', 'A.mp3')
    const { deps, trash } = setup({ ...NONE, traktor })
    expect(await retireSuperseded(old, deps)).toBe('used')
    expect(trash).not.toHaveBeenCalled()
  })

  it('keeps the source Traktor stays on when the output folder keeps a copy (B: the Mac default)', async () => {
    const source = '/Volumes/Public/Music/Media.localized/Music/T/A/03 A.aiff'
    const traktor = await traktorWith(
      'Public',
      '/:Music/:Media.localized/:Music/:T/:A/:',
      '03 A.aiff',
    )
    const { deps, trash } = setup({ ...NONE, traktor })
    expect(await retireSuperseded(source, deps)).toBe('used')
    expect(trash).not.toHaveBeenCalled()
  })

  it('keeps the Music copy rekordbox indexes when the libraries followed another file (C: supersededPath without replacesPath)', async () => {
    const musicCopy = '/Volumes/Public/Music/Media.localized/Music/T/A/03 A.aiff'
    const rekordbox = await rekordboxWith(musicCopy)
    const { deps, trash } = setup({ ...NONE, rekordbox })
    expect(await retireSuperseded(musicCopy, deps)).toBe('used')
    expect(trash).not.toHaveBeenCalled()
  })

  it('keeps the Music copy Engine DJ indexes, for the same reason', async () => {
    const musicCopy = '/Volumes/Public/Music/Media.localized/Music/T/A/03 A.aiff'
    const engine = await engineWith(musicCopy)
    const { deps, trash } = setup({ ...NONE, engine })
    expect(await retireSuperseded(musicCopy, deps)).toBe('used')
    expect(trash).not.toHaveBeenCalled()
  })

  it('keeps the file when a library cannot be read, since it may still use it', async () => {
    const { deps, trash } = setup({ ...NONE, rekordbox: join(root, 'missing.db') })
    expect(await retireSuperseded('/m/A.aiff', deps)).toBe('used')
    expect(trash).not.toHaveBeenCalled()
  })

  it('retires a file no library uses, recoverably where the disk has a Trash', async () => {
    const rekordbox = await rekordboxWith('/m/new/A.wav')
    const { deps, trash } = setup({ ...NONE, rekordbox })
    expect(await retireSuperseded('/m/old/A.aiff', deps)).toBe('retired')
    expect(trash).toHaveBeenCalledWith('/m/old/A.aiff', false)
  })

  it('deletes it for good under «Nunca» on a disk with no Trash, as the user asked', async () => {
    const { deps, trash } = setup(NONE, { keepsTrash: () => false, policy: () => 'never' })
    expect(await retireSuperseded('/m/old/A.aiff', deps)).toBe('retired')
    expect(trash).toHaveBeenCalledWith('/m/old/A.aiff', true)
  })

  it('leaves the row pending when the file’s folder cannot be reached, as a NAS that dropped for a moment', async () => {
    const { deps, trash } = setup(NONE, {
      exists: (p) => p !== '/Volumes/NAS/old' && p !== '/Volumes/NAS/old/A.aiff',
    })
    expect(await retireSuperseded('/Volumes/NAS/old/A.aiff', deps)).toBe('used')
    expect(trash).not.toHaveBeenCalled()
  })

  it('counts a file another row retired between the look and the trash as retired', async () => {
    let there = true
    const trash = vi.fn(async () => {
      there = false
      throw new Error('ENOENT: no such file')
    })
    const { deps } = setup(NONE, { exists: (p) => p === '/m/old' || there, trash })
    expect(await retireSuperseded('/m/old/A.aiff', deps)).toBe('retired')
  })

  it('still fails when the trash refused the file for any other reason', async () => {
    const busy = Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
    const { deps } = setup(NONE, { trash: vi.fn(async () => Promise.reject(busy)) })
    await expect(retireSuperseded('/m/old/A.aiff', deps)).rejects.toThrow('EBUSY')
  })

  it('counts a file already gone as retired, so an in-place rename that moved it raises no false failure', async () => {
    const { deps, trash } = setup(NONE, { exists: (p) => p === '/m/old' })
    expect(await retireSuperseded('/m/old/A.aiff', deps)).toBe('retired')
    expect(trash).not.toHaveBeenCalled()
  })
})
