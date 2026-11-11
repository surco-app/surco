import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it('refuses to write when the copy cannot be taken, so no write ever lands without one', async () => {
    const { database, backupDir, deps } = library()
    writeFileSync(backupDir, 'not a folder')
    const draft = createVirtualdjDraft()
    draft.write(database, edited(draft.read(database) as string))
    expect(await commitVirtualdjDraft(draft, deps())).toBe('backup-failed')
    expect(readFileSync(database, 'utf8')).toBe(fixture)
  })
})
