import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  commitVirtualdjDraft,
  createVirtualdjDraft,
  type VirtualdjCommitDeps,
} from './virtualdjLibraryWrite'

const fixture = readFileSync(join(__dirname, 'virtualdjFixtures', 'database.xml'), 'utf8')
const T0 = Date.UTC(2026, 10, 11, 9, 0, 0)

function library() {
  const base = mkdtempSync(join(tmpdir(), 'surco-vdj-write-'))
  const dir = join(base, 'VirtualDJ')
  mkdirSync(dir)
  const database = join(dir, 'database.xml')
  writeFileSync(database, fixture)
  const backupDir = join(base, 'virtualdj-backups')
  const deps = (over: Partial<VirtualdjCommitDeps> = {}): VirtualdjCommitDeps => ({
    backupDir,
    roots: () => [{ dir, root: '/' }],
    virtualdjOpen: async () => false,
    now: () => new Date(T0),
    ...over,
  })
  return { dir, database, backupDir, deps }
}

const edited = (xml: string) => xml.replace('Name="Surco"', 'Name="Surco escrito"')

describe('createVirtualdjDraft', () => {
  it('reads the disk once and then what earlier ops wrote, so a second op builds on the first', () => {
    const { database } = library()
    const draft = createVirtualdjDraft()
    const first = draft.read(database)
    expect(first).toBe(fixture)
    draft.write(database, edited(fixture))
    writeFileSync(database, 'changed on disk')
    expect(draft.read(database)).toBe(edited(fixture))
    expect(draft.changes()).toEqual([{ file: database, xml: edited(fixture) }])
  })

  it('leaves out a write that ends where the disk already is, so nothing is rewritten for no change', () => {
    const { database } = library()
    const draft = createVirtualdjDraft()
    draft.write(database, edited(fixture))
    draft.write(database, fixture)
    expect(draft.changes()).toEqual([])
  })
})

describe('commitVirtualdjDraft', () => {
  it('writes with VirtualDJ closed and keeps a copy of the database as it was first', async () => {
    const { database, backupDir, deps } = library()
    const draft = createVirtualdjDraft()
    draft.write(database, edited(draft.read(database) as string))
    expect(await commitVirtualdjDraft(draft, deps())).toBe('written')
    expect(readFileSync(database, 'utf8')).toBe(edited(fixture))
    const [folder] = readdirSync(backupDir)
    expect(folder).toBe('2026-11-11T09-00-00-000Z')
    expect(readFileSync(join(backupDir, folder, 'Local', 'database.xml'), 'utf8')).toBe(fixture)
  })

  it('backs up and writes when the VirtualDJ folder setting ends in a slash, instead of refusing every write', async () => {
    const { dir, database, backupDir, deps } = library()
    const draft = createVirtualdjDraft()
    draft.write(database, edited(draft.read(database) as string))
    expect(
      await commitVirtualdjDraft(draft, deps({ roots: () => [{ dir: `${dir}/`, root: '/' }] })),
    ).toBe('written')
    const [folder] = readdirSync(backupDir)
    expect(readFileSync(join(backupDir, folder, 'Local', 'database.xml'), 'utf8')).toBe(fixture)
  })

  it('keeps the CRLF line ends VirtualDJ needs, since LF makes it throw its database away', async () => {
    const { database, deps } = library()
    const draft = createVirtualdjDraft()
    draft.write(database, edited(draft.read(database) as string))
    await commitVirtualdjDraft(draft, deps())
    const xml = readFileSync(database, 'utf8')
    expect(xml.replace(/\r\n/g, '')).not.toContain('\n')
    expect(xml.split('\r\n').length).toBe(fixture.split('\r\n').length)
  })

  it('writes nothing and leaves no copy when nothing changed', async () => {
    const { database, backupDir, deps } = library()
    const draft = createVirtualdjDraft()
    draft.read(database)
    expect(await commitVirtualdjDraft(draft, deps())).toBe('nothing')
    expect(() => readdirSync(backupDir)).toThrow()
  })

  it('writes nothing while VirtualDJ is open, since VirtualDJ rewrites its database when it closes', async () => {
    const { database, deps } = library()
    const draft = createVirtualdjDraft()
    draft.write(database, edited(draft.read(database) as string))
    expect(await commitVirtualdjDraft(draft, deps({ virtualdjOpen: async () => true }))).toBe(
      'cancelled',
    )
    expect(readFileSync(database, 'utf8')).toBe(fixture)
  })

  it('clears a temporary file a crash left next to the database before it writes again', async () => {
    const { dir, database, deps } = library()
    writeFileSync(`${database}.surco-write`, 'half written')
    const draft = createVirtualdjDraft()
    draft.write(database, edited(draft.read(database) as string))
    expect(await commitVirtualdjDraft(draft, deps({ virtualdjOpen: async () => true }))).toBe(
      'cancelled',
    )
    expect(readdirSync(dir)).toEqual(['database.xml'])
  })

  it('does not rename when VirtualDJ opens after the copy, and leaves no temporary file behind', async () => {
    const { dir, database, deps } = library()
    const open = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const draft = createVirtualdjDraft()
    draft.write(database, edited(draft.read(database) as string))
    expect(await commitVirtualdjDraft(draft, deps({ virtualdjOpen: open }))).toBe('cancelled')
    expect(open.mock.calls.length).toBeGreaterThan(1)
    expect(readFileSync(database, 'utf8')).toBe(fixture)
    expect(readdirSync(dir)).toEqual(['database.xml'])
  })

  it('answers changed and writes nothing when someone else wrote the database while Surco took its copy', async () => {
    const { dir, database, deps } = library()
    const draft = createVirtualdjDraft()
    draft.write(database, edited(draft.read(database) as string))
    const theirs = fixture.replace('Genre="Electronic"', 'Genre="House"')
    let calls = 0
    const open = vi.fn(async () => {
      if (calls++ === 1) writeFileSync(database, theirs)
      return false
    })
    expect(await commitVirtualdjDraft(draft, deps({ virtualdjOpen: open }))).toBe('changed')
    expect(readFileSync(database, 'utf8')).toBe(theirs)
    expect(readdirSync(dir)).toEqual(['database.xml'])
  })

  it('checks VirtualDJ is closed for every database before renaming the first, so a rollback never lands under a running VirtualDJ', async () => {
    const { dir, database, backupDir, deps } = library()
    const volume = join(dirname(dir), 'Volumes', 'Public')
    const volumeDir = join(volume, 'VirtualDJ')
    mkdirSync(volumeDir, { recursive: true })
    const volumeDatabase = join(volumeDir, 'database.xml')
    writeFileSync(volumeDatabase, fixture)
    const untouched: boolean[] = []
    const open = vi.fn(async () => {
      untouched.push(
        readFileSync(database, 'utf8') === fixture &&
          readFileSync(volumeDatabase, 'utf8') === fixture,
      )
      return false
    })
    const draft = createVirtualdjDraft()
    draft.write(database, edited(draft.read(database) as string))
    draft.write(volumeDatabase, edited(draft.read(volumeDatabase) as string))
    const roots = () => [
      { dir, root: '/' },
      { dir: volumeDir, root: volume },
    ]
    expect(await commitVirtualdjDraft(draft, deps({ roots, virtualdjOpen: open }))).toBe('written')
    expect(untouched.length).toBeGreaterThan(1)
    expect(untouched.every(Boolean)).toBe(true)
    expect(readFileSync(volumeDatabase, 'utf8')).toBe(edited(fixture))
    const [folder] = readdirSync(backupDir)
    expect(readFileSync(join(backupDir, folder, 'Public', 'database.xml'), 'utf8')).toBe(fixture)
  })

  it('writes neither database when VirtualDJ opens at the last check of a save over two drives', async () => {
    const { dir, database, deps } = library()
    const volume = join(dirname(dir), 'Volumes', 'Public')
    const volumeDir = join(volume, 'VirtualDJ')
    mkdirSync(volumeDir, { recursive: true })
    const volumeDatabase = join(volumeDir, 'database.xml')
    writeFileSync(volumeDatabase, fixture)
    const open = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const draft = createVirtualdjDraft()
    draft.write(database, edited(draft.read(database) as string))
    draft.write(volumeDatabase, edited(draft.read(volumeDatabase) as string))
    const roots = () => [
      { dir, root: '/' },
      { dir: volumeDir, root: volume },
    ]
    expect(await commitVirtualdjDraft(draft, deps({ roots, virtualdjOpen: open }))).toBe(
      'cancelled',
    )
    expect(readFileSync(database, 'utf8')).toBe(fixture)
    expect(readFileSync(volumeDatabase, 'utf8')).toBe(fixture)
    expect(readdirSync(volumeDir)).toEqual(['database.xml'])
  })

  it('keeps only the last 20 copies, as with Serato', async () => {
    const { database, backupDir, deps } = library()
    for (let i = 0; i < 22; i++) {
      const draft = createVirtualdjDraft()
      draft.write(database, `${draft.read(database)}\r\n`)
      expect(await commitVirtualdjDraft(draft, deps({ now: () => new Date(T0 + i * 1000) }))).toBe(
        'written',
      )
    }
    const kept = readdirSync(backupDir).sort()
    expect(kept).toHaveLength(20)
    expect(kept[0]).toBe('2026-11-11T09-00-02-000Z')
  })

  it('never prunes the MyLists copies kept beside the database ones', async () => {
    const { database, backupDir, deps } = library()
    mkdirSync(join(backupDir, 'lists'), { recursive: true })
    for (let i = 0; i < 22; i++) {
      const draft = createVirtualdjDraft()
      draft.write(database, `${draft.read(database)}\r\n`)
      await commitVirtualdjDraft(draft, deps({ now: () => new Date(T0 + i * 1000) }))
    }
    const kept = readdirSync(backupDir).sort()
    expect(kept).toContain('lists')
    expect(kept.filter((n) => n !== 'lists')).toHaveLength(20)
  })

  it('refuses as unreadable a database holding a byte that is not UTF-8, so another song’s path is never rewritten into a replacement character', async () => {
    const { database, backupDir, deps } = library()
    const at = fixture.indexOf('Pray.wav')
    const bad = Buffer.concat([
      Buffer.from(fixture.slice(0, at), 'utf8'),
      Buffer.from([0x50, 0xe9]),
      Buffer.from(fixture.slice(at + 'Pray'.length), 'utf8'),
    ])
    writeFileSync(database, bad)
    const draft = createVirtualdjDraft()
    draft.write(database, edited(draft.read(database) as string))
    expect(await commitVirtualdjDraft(draft, deps())).toBe('unreadable')
    expect(readFileSync(database)).toEqual(bad)
    expect(readdirSync(dirname(database))).toEqual(['database.xml'])
    expect(() => readdirSync(backupDir)).toThrow()
  })

  it('refuses to write when the copy cannot be taken, so no write ever lands without one', async () => {
    const { database, backupDir, deps } = library()
    writeFileSync(backupDir, 'not a folder')
    const draft = createVirtualdjDraft()
    draft.write(database, edited(draft.read(database) as string))
    expect(await commitVirtualdjDraft(draft, deps())).toBe('backup-failed')
    expect(readFileSync(database, 'utf8')).toBe(fixture)
  })
})
