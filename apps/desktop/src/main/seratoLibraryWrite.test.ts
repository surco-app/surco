import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./seratoCuesWrite', () => ({ applySeratoCuesBatch: vi.fn() }))

import { crateFileOf } from './seratoCrateFile'
import {
  apply,
  crateBytes,
  create,
  onlyBackupOf,
  tempsUnder,
  touch,
  twoRoots,
} from './seratoLibraryFixture'
import { backupFolderName, commitSeratoDraft, createSeratoDraft } from './seratoLibraryWrite'

const T0 = Date.UTC(2026, 10, 4, 9, 0, 0)

describe('createSeratoDraft', () => {
  it('reads the disk once and then its own layer, so later ops see earlier ones', () => {
    const { roots } = twoRoots({ internal: ['A'] })
    const a = crateFileOf(roots[0], 'A')
    const x = crateFileOf(roots[0], 'X')
    const draft = createSeratoDraft()
    const before = draft.read(a)
    draft.rename(a, x)
    expect(draft.exists(a)).toBe(false)
    expect(draft.read(x)).toEqual(before)
    draft.remove(x)
    expect(draft.exists(x)).toBe(false)
    expect(existsSync(a)).toBe(true)
    expect([...draft.stamps().keys()]).toContain(a)
  })

  it('lists a folder as the ops so far leave it', () => {
    const { roots } = twoRoots({ internal: ['A', 'B'] })
    const dir = join(roots[0].dir, 'Subcrates')
    const draft = createSeratoDraft()
    draft.write(crateFileOf(roots[0], 'N'), crateBytes([]))
    draft.remove(crateFileOf(roots[0], 'B'))
    expect(draft.list(dir).sort()).toEqual(['A.crate', 'N.crate'])
  })
})

describe('commitSeratoDraft', () => {
  it('says nothing was written when the draft changed nothing', async () => {
    const { roots, deps } = twoRoots({ internal: ['A'] })
    const draft = createSeratoDraft()
    draft.read(crateFileOf(roots[0], 'A'))
    expect(await commitSeratoDraft(draft, deps)).toBe('nothing')
    expect(existsSync(deps.backupDir)).toBe(false)
  })

  it('writes through a temp file and leaves none behind', async () => {
    const { roots, deps } = twoRoots({ internal: ['A'] })
    const a = crateFileOf(roots[0], 'A')
    const draft = createSeratoDraft()
    draft.write(a, crateBytes(['Users/dj/new.mp3']))
    expect(await commitSeratoDraft(draft, deps)).toBe('written')
    expect(readFileSync(a)).toEqual(crateBytes(['Users/dj/new.mp3']))
    expect(tempsUnder(roots[0].dir)).toEqual([])
  })

  it('names the backup of a crate on an external drive after the drive', async () => {
    const { roots, deps, bytes } = twoRoots({ gig: ['A'] })
    const draft = createSeratoDraft()
    draft.remove(crateFileOf(roots[1], 'A'))
    await commitSeratoDraft(draft, deps)
    expect(readFileSync(onlyBackupOf(deps.backupDir, 'Gig/Subcrates/A.crate'))).toEqual(bytes.gig.A)
  })

  it('does not write when a crate it read changed on disk before the rename, so a Serato save is never overwritten', async () => {
    const { roots, deps } = twoRoots({ internal: ['A'] })
    const a = crateFileOf(roots[0], 'A')
    const draft = createSeratoDraft()
    draft.write(a, crateBytes(['Users/dj/mine.mp3']))
    touch(a, 'Users/dj/theirs.mp3')
    const theirs = readFileSync(a)
    expect(await commitSeratoDraft(draft, deps)).toBe('cancelled')
    expect(readFileSync(a)).toEqual(theirs)
    expect(tempsUnder(roots[0].dir)).toEqual([])
  })

  it('does not create a crate that appeared on disk after the draft saw it missing', async () => {
    const { roots, deps } = twoRoots({ internal: [] })
    const n = crateFileOf(roots[0], 'N')
    const draft = createSeratoDraft()
    expect(draft.exists(n)).toBe(false)
    draft.write(n, crateBytes(['Users/dj/mine.mp3']))
    writeFileSync(n, crateBytes(['Users/dj/theirs.mp3']))
    expect(await commitSeratoDraft(draft, deps)).toBe('cancelled')
    expect(readFileSync(n)).toEqual(crateBytes(['Users/dj/theirs.mp3']))
  })

  it('puts back every file already written when Serato opens halfway', async () => {
    const { roots, deps, bytes } = twoRoots({ internal: ['A', 'B'] })
    const draft = createSeratoDraft()
    draft.write(crateFileOf(roots[0], 'A'), crateBytes(['Users/dj/a2.mp3']))
    draft.write(crateFileOf(roots[0], 'B'), crateBytes(['Users/dj/b2.mp3']))
    draft.write(crateFileOf(roots[0], 'N'), crateBytes([]))
    let checks = 0
    const seratoOpen = async () => ++checks > 3
    expect(await commitSeratoDraft(draft, { ...deps, seratoOpen })).toBe('cancelled')
    expect(checks).toBe(4)
    expect(readFileSync(crateFileOf(roots[0], 'A'))).toEqual(bytes.internal.A)
    expect(readFileSync(crateFileOf(roots[0], 'B'))).toEqual(bytes.internal.B)
    expect(existsSync(crateFileOf(roots[0], 'N'))).toBe(false)
    expect(tempsUnder(roots[0].dir)).toEqual([])
  })

  it('puts back a crate moved halfway through a rename when a crate it read changes', async () => {
    const { roots, deps, bytes } = twoRoots({ internal: ['A', 'B'] })
    const a = crateFileOf(roots[0], 'A')
    const b = crateFileOf(roots[0], 'B')
    const draft = createSeratoDraft()
    draft.rename(a, crateFileOf(roots[0], 'X'))
    draft.remove(b)
    let checks = 0
    const seratoOpen = async () => {
      if (++checks === 3) touch(b, 'Users/dj/theirs.mp3')
      return false
    }
    expect(await commitSeratoDraft(draft, { ...deps, seratoOpen })).toBe('cancelled')
    expect(readFileSync(a)).toEqual(bytes.internal.A)
    expect(existsSync(crateFileOf(roots[0], 'X'))).toBe(false)
    expect(tempsUnder(roots[0].dir)).toEqual([])
  })

  it('undoes what it wrote and says so when a step fails', async () => {
    const { roots, deps, bytes } = twoRoots({ internal: ['A'] })
    const draft = createSeratoDraft()
    draft.write(crateFileOf(roots[0], 'A'), crateBytes(['Users/dj/a2.mp3']))
    draft.rename(crateFileOf(roots[0], 'A'), crateFileOf(roots[0], 'X'))
    let checks = 0
    const seratoOpen = async () => {
      if (++checks === 3) mkdirSync(`${crateFileOf(roots[0], 'A')}.surco-tmp`)
      return false
    }
    expect(await commitSeratoDraft(draft, { ...deps, seratoOpen })).toBe('write-failed')
    rmSync(`${crateFileOf(roots[0], 'A')}.surco-tmp`, { recursive: true, force: true })
    expect(readFileSync(crateFileOf(roots[0], 'A'))).toEqual(bytes.internal.A)
    expect(existsSync(crateFileOf(roots[0], 'X'))).toBe(false)
  })

  it('refuses to write when the backup cannot be made', async () => {
    const { roots, deps, bytes } = twoRoots({ internal: ['A'] })
    writeFileSync(deps.backupDir, 'not a folder')
    const draft = createSeratoDraft()
    draft.remove(crateFileOf(roots[0], 'A'))
    expect(await commitSeratoDraft(draft, deps)).toBe('backup-failed')
    expect(readFileSync(crateFileOf(roots[0], 'A'))).toEqual(bytes.internal.A)
  })

  it('keeps only the newest 20 backup folders', async () => {
    const { roots, deps } = twoRoots({ internal: [] })
    for (let i = 0; i < 21; i++)
      await apply(roots, { ...deps, now: () => new Date(T0 + i * 1000) }, create('root', `C${i}`))
    expect(readdirSync(deps.backupDir).sort()[0]).toBe(backupFolderName(new Date(T0 + 1000)))
    expect(readdirSync(deps.backupDir)).toHaveLength(20)
  })

  it('asks whether Serato is open once more before each rename', async () => {
    const { roots, deps } = twoRoots({ internal: ['A'] })
    const seratoOpen = vi.fn(async () => false)
    const draft = createSeratoDraft()
    draft.rename(crateFileOf(roots[0], 'A'), crateFileOf(roots[0], 'X'))
    expect(await commitSeratoDraft(draft, { ...deps, seratoOpen })).toBe('written')
    expect(seratoOpen).toHaveBeenCalledTimes(3)
  })
})
