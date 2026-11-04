import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./seratoCuesWrite', () => ({ applySeratoCuesBatch: vi.fn() }))

import { applySeratoLibraryOps } from './seratoBatch'
import { seratoEditFiles } from './seratoCrateEdits'
import { crateFileOf, crateTrackPaths, seratoLinkId } from './seratoCrateFile'
import {
  addTo,
  apply,
  applyOne,
  crateBytes,
  create,
  del,
  editOp,
  listCrates,
  move,
  onlyBackupOf,
  remove,
  rename,
  rewrittenBySerato,
  touch,
  twoRoots,
} from './seratoLibraryFixture'

describe('creating a crate', () => {
  it('creates a root crate in the internal _Serato_ and a subcrate wherever the parent is', async () => {
    const { roots, deps } = twoRoots({ internal: ['A'], gig: ['A'] })
    await apply(roots, deps, create('root', 'New'), create('A', 'Sub'))
    expect(existsSync(crateFileOf(roots[0], 'New'))).toBe(true)
    expect(existsSync(crateFileOf(roots[1], 'New'))).toBe(false)
    expect(roots.every((r) => existsSync(crateFileOf(r, 'A%%Sub')))).toBe(true)
  })

  it('creates an empty crate Serato can read and hands back its id', async () => {
    const { roots, deps } = twoRoots({ internal: ['A'] })
    const outcome = await apply(roots, deps, create('A', 'Sub'))
    expect(outcome).toMatchObject({ applied: true, createdId: 'A%%Sub' })
    expect(crateTrackPaths(readFileSync(crateFileOf(roots[0], 'A%%Sub')))).toEqual([])
  })

  it('creates a root crate on the first library when there is no internal one', async () => {
    const { roots, deps } = twoRoots({ gig: ['A'] })
    const gigOnly = { ...deps, roots: () => [roots[1]] }
    await apply([roots[1]], gigOnly, create('root', 'New'))
    expect(existsSync(crateFileOf(roots[1], 'New'))).toBe(true)
  })

  it('refuses a name another crate already has, whatever its case, so no file is overwritten', async () => {
    const { roots, deps, bytes } = twoRoots({ internal: ['House'] })
    expect(await apply(roots, deps, create('root', 'house'))).toMatchObject({
      applied: false,
      reason: 'bad-name',
    })
    expect(readFileSync(crateFileOf(roots[0], 'House'))).toEqual(bytes.internal.House)
  })

  it('refuses a subcrate of a crate that is gone', async () => {
    const { roots, deps } = twoRoots({ internal: [] })
    expect(await apply(roots, deps, create('A', 'Sub'))).toMatchObject({
      applied: false,
      reason: 'stale',
    })
  })
})

describe('renaming a crate', () => {
  it('renames a crate and every subcrate file in every root, keeping their bytes', async () => {
    const { roots, deps, bytes } = twoRoots({
      internal: ['A', 'A%%B', 'A%%B%%C', 'AB'],
      gig: ['A%%B'],
    })
    const outcome = await apply(roots, deps, rename('A%%B', 'X'))
    expect(outcome.applied).toBe(true)
    expect(readFileSync(crateFileOf(roots[0], 'A%%X%%C'))).toEqual(bytes.internal['A%%B%%C'])
    expect(existsSync(crateFileOf(roots[1], 'A%%X'))).toBe(true)
    expect(existsSync(crateFileOf(roots[0], 'AB'))).toBe(true)
    expect(listCrates(roots[0])).not.toContain('A%%B.crate')
  })

  it('leaves a crate whose name only starts like the renamed one', async () => {
    const { roots, deps, bytes } = twoRoots({ internal: ['A', 'AB', 'AB%%C'] })
    await apply(roots, deps, rename('A', 'Z'))
    expect(listCrates(roots[0])).toEqual(['AB%%C.crate', 'AB.crate', 'Z.crate'])
    expect(readFileSync(crateFileOf(roots[0], 'AB%%C'))).toEqual(bytes.internal['AB%%C'])
  })

  it('renames house to House on a case-insensitive disk', async () => {
    const { roots, deps } = twoRoots({ internal: ['house'] })
    expect((await apply(roots, deps, rename('house', 'House'))).applied).toBe(true)
    expect(listCrates(roots[0])).toEqual(['House.crate'])
  })

  it.each([
    ['', 'empty'],
    ['a%%b', '%%'],
    ['a/b', 'slash'],
    ['AB', 'taken'],
    ['ab', 'taken in another case'],
  ])('refuses the name %s (%s)', async (name) => {
    const { roots, deps } = twoRoots({ internal: ['A', 'AB'] })
    expect(await apply(roots, deps, rename('A', name))).toMatchObject({
      applied: false,
      reason: 'bad-name',
    })
    expect(listCrates(roots[0])).toEqual(['A.crate', 'AB.crate'])
  })

  it('refuses a rename whose subcrate would land on a crate that exists', async () => {
    const { roots, deps } = twoRoots({ internal: ['A', 'A%%C', 'X%%C'] })
    expect(await apply(roots, deps, rename('A', 'X'))).toMatchObject({
      applied: false,
      reason: 'bad-name',
    })
    expect(listCrates(roots[0])).toEqual(['A%%C.crate', 'A.crate', 'X%%C.crate'])
  })

  it('refuses to rename a crate Serato cannot read back', async () => {
    const { roots, deps } = twoRoots({ internal: ['A'] })
    writeFileSync(crateFileOf(roots[0], 'A'), Buffer.from('vrsn\0\0\x01\0'))
    expect(await apply(roots, deps, rename('A', 'X'))).toMatchObject({
      applied: false,
      reason: 'unreadable',
    })
    expect(listCrates(roots[0])).toEqual(['A.crate'])
  })
})

describe('deleting a crate', () => {
  it('deletes a crate with its subcrates and nothing else', async () => {
    const { roots, deps } = twoRoots({ internal: ['A', 'A%%B', 'AB'] })
    await apply(roots, deps, del('A'))
    expect(listCrates(roots[0])).toEqual(['AB.crate'])
  })

  it('deletes the crate from every library that has it', async () => {
    const { roots, deps } = twoRoots({ internal: ['A'], gig: ['A', 'A%%B'] })
    await apply(roots, deps, del('A'))
    expect(listCrates(roots[0])).toEqual([])
    expect(listCrates(roots[1])).toEqual([])
  })

  it('copies every file it touches into serato-backups before writing', async () => {
    const { roots, deps, bytes } = twoRoots({ internal: ['A'] })
    await apply(roots, deps, del('A'))
    expect(readFileSync(onlyBackupOf(deps.backupDir, 'Music/Subcrates/A.crate'))).toEqual(
      bytes.internal.A,
    )
  })
})

function onDisk(...files: string[]): void {
  for (const file of files) {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, 'audio')
  }
}

describe('tracks in a crate', () => {
  it('adds tracks to the crate file on their own volume and counts the rest', async () => {
    const { base, roots, deps } = twoRoots({ internal: [['A', []]], gig: [['A', []]] })
    const a = join(base, 'home', 'dj', 'a.mp3')
    const b = join(roots[1].root, 'b.mp3')
    onDisk(a, b)
    const outcome = await apply(
      roots,
      deps,
      addTo('A', a, b, '/Volumes/Other/c.mp3', join(base, 'home', 'dj', 'missing.mp3')),
    )
    expect(outcome.report).toEqual({ added: 2, already: 0, notInCollection: 2, ambiguous: 0 })
    expect(crateTrackPaths(readFileSync(crateFileOf(roots[1], 'A')))).toEqual(['b.mp3'])
    expect(crateTrackPaths(readFileSync(crateFileOf(roots[0], 'A')))).toEqual([a.slice(1)])
  })

  it('takes the last path of a track as the file to add', async () => {
    const { base, roots, deps } = twoRoots({ internal: [['A', []]] })
    const now = join(base, 'home', 'dj', 'now.mp3')
    onDisk(now)
    await apply(roots, deps, {
      kind: 'add',
      playlistId: 'A',
      tracks: [{ paths: [join(base, 'home', 'dj', 'before.mp3'), now] }],
    })
    expect(crateTrackPaths(readFileSync(crateFileOf(roots[0], 'A')))).toEqual([now.slice(1)])
  })

  it('counts a track already in the crate under another normalization as already there', async () => {
    const { roots, deps } = twoRoots({
      internal: [['A', ['Users/dj/Música/a.mp3'.normalize('NFD')]]],
    })
    const outcome = await apply(roots, deps, addTo('A', '/Users/dj/Música/a.mp3'.normalize('NFC')))
    expect(outcome.report).toMatchObject({ added: 0, already: 1 })
  })

  it('refuses a track for a crate that only lives on another drive', async () => {
    const { roots, deps } = twoRoots({ gig: ['OnlyGig'] })
    expect((await apply(roots, deps, addTo('OnlyGig', '/Users/dj/a.mp3'))).report).toMatchObject({
      added: 0,
      notInCollection: 1,
    })
  })

  it('moves and removes rows by link id, keeping the crate columns', async () => {
    const { roots, deps } = twoRoots({ internal: [['A', ['a', 'b', 'c']]] })
    const file = crateFileOf(roots[0], 'A')
    const columns = (): Buffer => {
      const bytes = readFileSync(file)
      return bytes.subarray(0, bytes.indexOf('otrk'))
    }
    const before = columns()
    await apply(roots, deps, move('A', [seratoLinkId(2, file, 'c')], seratoLinkId(0, file, 'a')))
    expect(crateTrackPaths(readFileSync(file))).toEqual(['c', 'a', 'b'])
    await apply(roots, deps, remove('A', [seratoLinkId(1, file, 'a')]))
    expect(crateTrackPaths(readFileSync(file))).toEqual(['c', 'b'])
    expect(columns()).toEqual(before)
  })

  it('moves rows to the end when there is nothing to land before', async () => {
    const { roots, deps } = twoRoots({ internal: [['A', ['a', 'b', 'c']]] })
    const file = crateFileOf(roots[0], 'A')
    await apply(roots, deps, move('A', [seratoLinkId(0, file, 'a')], null))
    expect(crateTrackPaths(readFileSync(file))).toEqual(['b', 'c', 'a'])
  })

  it('refuses to remove a row the crate no longer has', async () => {
    const { roots, deps } = twoRoots({ internal: [['A', ['a']]] })
    const file = crateFileOf(roots[0], 'A')
    expect(await apply(roots, deps, remove('A', [seratoLinkId(1, file, 'b')]))).toMatchObject({
      applied: false,
      reason: 'stale',
    })
    expect(crateTrackPaths(readFileSync(file))).toEqual(['a'])
  })

  it('never touches a row of another crate, whatever link id it is given', async () => {
    const { roots, deps } = twoRoots({
      internal: [
        ['A', ['a']],
        ['B', ['b']],
      ],
    })
    const other = crateFileOf(roots[0], 'B')
    expect(await apply(roots, deps, remove('A', [seratoLinkId(0, other, 'b')]))).toMatchObject({
      applied: false,
      reason: 'stale',
    })
    expect(crateTrackPaths(readFileSync(other))).toEqual(['b'])
  })

  it('refuses a move across the crate files of two drives', async () => {
    const { roots, deps } = twoRoots({ internal: [['A', ['a', 'b']]], gig: [['A', ['c']]] })
    const internal = crateFileOf(roots[0], 'A')
    const gig = crateFileOf(roots[1], 'A')
    expect(
      await apply(
        roots,
        deps,
        move('A', [seratoLinkId(0, gig, 'c')], seratoLinkId(0, internal, 'a')),
      ),
    ).toMatchObject({ applied: false, reason: 'stale' })
    expect(
      await apply(
        roots,
        deps,
        move('A', [seratoLinkId(0, internal, 'a'), seratoLinkId(0, gig, 'c')], null),
      ),
    ).toMatchObject({ applied: false, reason: 'stale' })
    expect(crateTrackPaths(readFileSync(internal))).toEqual(['a', 'b'])
  })

  it('refuses a remove named from a list that a prior remove already shifted, and leaves the crate as it is', async () => {
    const { roots, deps } = twoRoots({ internal: [['A', ['a', 'b', 'c']]] })
    const file = crateFileOf(roots[0], 'A')
    await apply(roots, deps, remove('A', [seratoLinkId(0, file, 'a')]))
    const shifted = readFileSync(file)
    expect(await apply(roots, deps, remove('A', [seratoLinkId(1, file, 'b')]))).toMatchObject({
      applied: false,
      reason: 'stale',
    })
    expect(readFileSync(file)).toEqual(shifted)
  })

  it('refuses a move named from a list that a prior remove already shifted, and leaves the crate as it is', async () => {
    const { roots, deps } = twoRoots({ internal: [['A', ['a', 'b', 'c']]] })
    const file = crateFileOf(roots[0], 'A')
    await apply(roots, deps, remove('A', [seratoLinkId(0, file, 'a')]))
    const shifted = readFileSync(file)
    expect(await apply(roots, deps, move('A', [seratoLinkId(1, file, 'b')], null))).toMatchObject({
      applied: false,
      reason: 'stale',
    })
    expect(
      await apply(roots, deps, move('A', [seratoLinkId(0, file, 'b')], seratoLinkId(1, file, 'b'))),
    ).toMatchObject({ applied: false, reason: 'stale' })
    expect(readFileSync(file)).toEqual(shifted)
  })

  it('applies two moves queued on one crate while Serato was open, in order, once it closes', async () => {
    const { roots, deps } = twoRoots({ internal: [['A', ['a', 'b', 'c']]] })
    const file = crateFileOf(roots[0], 'A')
    const first = move('A', [seratoLinkId(2, file, 'c')], seratoLinkId(0, file, 'a'))
    const second = move('A', [seratoLinkId(0, file, 'a')], null)
    const ops = [
      editOp(first, seratoEditFiles(first, roots)),
      editOp(second, seratoEditFiles(second, roots)),
    ]
    const result = await applySeratoLibraryOps(ops, { ...deps, ensureClosed: async () => true })
    expect(result).toMatchObject({
      ok: true,
      outcomes: [{ applied: true }, { applied: true }],
    })
    expect(crateTrackPaths(readFileSync(file))).toEqual(['c', 'b', 'a'])
  })

  it('finds a row whose path the crate keeps in another Unicode form than the link id', async () => {
    const nfd = 'Música/a.mp3'.normalize('NFD')
    const { roots, deps } = twoRoots({ internal: [['A', [nfd, 'b']]] })
    const file = crateFileOf(roots[0], 'A')
    await apply(roots, deps, remove('A', [seratoLinkId(0, file, nfd.normalize('NFC'))]))
    expect(crateTrackPaths(readFileSync(file))).toEqual(['b'])
  })

  it('reads no file a link id names unless it belongs to the crate', async () => {
    const { roots, deps } = twoRoots({ internal: [['A', ['a']], 'B'], truncated: ['B'] })
    const other = crateFileOf(roots[0], 'B')
    expect(await apply(roots, deps, remove('A', [seratoLinkId(0, other, 'b')]))).toMatchObject({
      applied: false,
      reason: 'stale',
    })
  })

  it('never rewrites a truncated crate', async () => {
    const { roots, deps, bytes } = twoRoots({ internal: ['A'], truncated: ['A'] })
    expect(await apply(roots, deps, addTo('A', '/Users/dj/a.mp3'))).toMatchObject({
      applied: false,
      reason: 'unreadable',
    })
    expect(readFileSync(crateFileOf(roots[0], 'A'))).toEqual(bytes.internal.A)
  })
})

describe('an edit queued while Serato was open', () => {
  it('refuses an edit whose crate changed after the user saw it, and says so', async () => {
    const { roots, deps } = twoRoots({ internal: ['A'] })
    const op = editOp(rename('A', 'X'), seratoEditFiles(rename('A', 'X'), roots))
    touch(crateFileOf(roots[0], 'A'), 'Users/dj/one more.mp3')
    expect(await applyOne(op, deps)).toMatchObject({
      applied: false,
      reason: 'stale',
      notices: [{ code: 'edit-changed', playlist: 'Crate' }],
    })
  })

  it("refuses a queued crate edit when the crate's tracks changed since the user saw them", async () => {
    const { roots, deps } = twoRoots({ internal: ['A', 'A%%B'] })
    const op = editOp(del('A'), seratoEditFiles(del('A'), roots))
    touch(crateFileOf(roots[0], 'A%%B'), 'Users/dj/new.mp3')
    const changed = readFileSync(crateFileOf(roots[0], 'A%%B'))
    expect(await applyOne(op, deps)).toMatchObject({ applied: false, reason: 'stale' })
    expect(readFileSync(crateFileOf(roots[0], 'A%%B'))).toEqual(changed)
  })

  it('applies a queued crate edit when Serato rewrote the crate with the same tracks', async () => {
    const { roots, deps } = twoRoots({ internal: ['A'] })
    const op = editOp(rename('A', 'X'), seratoEditFiles(rename('A', 'X'), roots))
    rewrittenBySerato(crateFileOf(roots[0], 'A'), new Date(Date.now() + 60_000))
    expect(await applyOne(op, deps)).toMatchObject({ applied: true })
    expect(listCrates(roots[0])).toEqual(['X.crate'])
  })

  it('refuses when a crate that must not exist appears', async () => {
    const { roots, deps } = twoRoots({ internal: [] })
    const op = editOp(create('root', 'New'), seratoEditFiles(create('root', 'New'), roots))
    writeFileSync(crateFileOf(roots[0], 'New'), crateBytes(['Users/dj/theirs.mp3']))
    expect(await applyOne(op, deps)).toMatchObject({ applied: false, reason: 'stale' })
    expect(crateTrackPaths(readFileSync(crateFileOf(roots[0], 'New')))).toEqual([
      'Users/dj/theirs.mp3',
    ])
  })

  it('refuses when a crate the user saw is gone', async () => {
    const { roots, deps } = twoRoots({ internal: ['A'], gig: ['A'] })
    const op = editOp(del('A'), seratoEditFiles(del('A'), roots))
    rmSync(crateFileOf(roots[1], 'A'))
    expect(await applyOne(op, deps)).toMatchObject({ applied: false, reason: 'stale' })
    expect(existsSync(crateFileOf(roots[0], 'A'))).toBe(true)
  })
})

describe('crate and track edits queued together while Serato was open', () => {
  async function queuedTogether(
    roots: ReturnType<typeof twoRoots>['roots'],
    deps: ReturnType<typeof twoRoots>['deps'],
    ...edits: Parameters<typeof seratoEditFiles>[0][]
  ) {
    const ops = edits.map((edit) => editOp(edit, seratoEditFiles(edit, roots)))
    return applySeratoLibraryOps(ops, { ...deps, ensureClosed: async () => true })
  }
  const allApplied = (count: number) => ({
    ok: true,
    outcomes: Array.from({ length: count }, () => ({ applied: true, notices: [] })),
  })

  it('moves rows and then renames the crate', async () => {
    const { roots, deps } = twoRoots({ internal: [['A', ['a', 'b', 'c']]] })
    const file = crateFileOf(roots[0], 'A')
    const result = await queuedTogether(
      roots,
      deps,
      move('A', [seratoLinkId(2, file, 'c')], seratoLinkId(0, file, 'a')),
      rename('A', 'B'),
    )
    expect(result).toMatchObject(allApplied(2))
    expect(listCrates(roots[0])).toEqual(['B.crate'])
    expect(crateTrackPaths(readFileSync(crateFileOf(roots[0], 'B')))).toEqual(['c', 'a', 'b'])
  })

  it('removes a row and then deletes the crate', async () => {
    const { roots, deps } = twoRoots({ internal: [['A', ['a', 'b']]] })
    const file = crateFileOf(roots[0], 'A')
    const result = await queuedTogether(
      roots,
      deps,
      remove('A', [seratoLinkId(0, file, 'a')]),
      del('A'),
    )
    expect(result).toMatchObject(allApplied(2))
    expect(listCrates(roots[0])).toEqual([])
  })

  it('removes a row and then creates a subcrate under the crate', async () => {
    const { roots, deps } = twoRoots({ internal: [['A', ['a', 'b']]] })
    const file = crateFileOf(roots[0], 'A')
    const result = await queuedTogether(
      roots,
      deps,
      remove('A', [seratoLinkId(0, file, 'a')]),
      create('A', 'Sub'),
    )
    expect(result).toMatchObject(allApplied(2))
    expect(listCrates(roots[0])).toEqual(['A%%Sub.crate', 'A.crate'])
    expect(crateTrackPaths(readFileSync(file))).toEqual(['b'])
  })

  it('renames the crate and then moves rows named from the list under its old name', async () => {
    const { roots, deps } = twoRoots({
      internal: [
        ['A', ['a', 'b', 'c']],
        ['A%%Sub', ['s', 't']],
      ],
    })
    const file = crateFileOf(roots[0], 'A')
    const sub = crateFileOf(roots[0], 'A%%Sub')
    const result = await queuedTogether(
      roots,
      deps,
      rename('A', 'B'),
      move('A', [seratoLinkId(2, file, 'c')], seratoLinkId(0, file, 'a')),
      remove('A%%Sub', [seratoLinkId(0, sub, 's')]),
    )
    expect(result).toMatchObject(allApplied(3))
    expect(listCrates(roots[0])).toEqual(['B%%Sub.crate', 'B.crate'])
    expect(crateTrackPaths(readFileSync(crateFileOf(roots[0], 'B')))).toEqual(['c', 'a', 'b'])
    expect(crateTrackPaths(readFileSync(crateFileOf(roots[0], 'B%%Sub')))).toEqual(['t'])
  })

  it('counts a track edit on a crate deleted earlier in the batch as done, without a notice', async () => {
    const { roots, deps } = twoRoots({ internal: [['A', ['a', 'b']]] })
    const file = crateFileOf(roots[0], 'A')
    const result = await queuedTogether(
      roots,
      deps,
      del('A'),
      remove('A', [seratoLinkId(0, file, 'a')]),
    )
    expect(result).toMatchObject(allApplied(2))
    expect(listCrates(roots[0])).toEqual([])
  })

  it('refuses a remove or a move on a crate Serato deleted before the batch, and says so', async () => {
    const { roots, deps } = twoRoots({ internal: [['A', ['a', 'b']]] })
    const file = crateFileOf(roots[0], 'A')
    rmSync(file)
    const changed = { applied: false, reason: 'stale', notices: [{ code: 'edit-changed' }] }
    expect(await apply(roots, deps, remove('A', [seratoLinkId(0, file, 'a')]))).toMatchObject(
      changed,
    )
    expect(await apply(roots, deps, move('A', [seratoLinkId(0, file, 'a')], null))).toMatchObject(
      changed,
    )
  })

  it('counts an add to a crate deleted earlier in the batch as done, without a notice', async () => {
    const { base, roots, deps } = twoRoots({ internal: [['A', ['a']]] })
    const track = join(base, 'home', 'dj', 'new.mp3')
    onDisk(track)
    const result = await queuedTogether(roots, deps, del('A'), addTo('A', track))
    expect(result).toMatchObject(allApplied(2))
    expect(listCrates(roots[0])).toEqual([])
  })

  it('refuses an add to a crate replaced at the same name earlier in the batch', async () => {
    const { base, roots, deps } = twoRoots({ internal: [['A', ['a']]] })
    const track = join(base, 'home', 'dj', 'new.mp3')
    onDisk(track)
    const ops = [editOp(del('A')), editOp(create('root', 'A')), editOp(addTo('A', track))]
    const result = await applySeratoLibraryOps(ops, { ...deps, ensureClosed: async () => true })
    expect(result).toMatchObject({
      ok: true,
      outcomes: [{ applied: true }, { applied: true }, { applied: false, reason: 'stale' }],
    })
    expect(crateTrackPaths(readFileSync(crateFileOf(roots[0], 'A')))).toEqual([])
  })

  it('still refuses a queued rename when Serato changed the crate before the batch', async () => {
    const { roots, deps } = twoRoots({ internal: [['A', ['a', 'b']]] })
    const file = crateFileOf(roots[0], 'A')
    const ops = [
      editOp(remove('A', [seratoLinkId(0, file, 'a')])),
      editOp(rename('A', 'B'), seratoEditFiles(rename('A', 'B'), roots)),
    ]
    touch(file, 'Users/dj/theirs.mp3')
    const result = await applySeratoLibraryOps(ops, { ...deps, ensureClosed: async () => true })
    expect(result).toMatchObject({
      ok: true,
      outcomes: [{ applied: true }, { applied: false, reason: 'stale' }],
    })
    expect(listCrates(roots[0])).toEqual(['A.crate'])
  })
})

describe('seratoEditFiles', () => {
  it('stamps the tracks of the parent and the new crate as missing where it will go', () => {
    const { roots } = twoRoots({ internal: ['A'], gig: ['A'] })
    expect(seratoEditFiles(create('A', 'Sub'), roots)).toEqual({
      [crateFileOf(roots[0], 'A')]: { tracks: ['Users/dj/internal/A.mp3'] },
      [crateFileOf(roots[1], 'A')]: { tracks: ['Users/dj/gig/A.mp3'] },
      [crateFileOf(roots[0], 'A%%Sub')]: null,
      [crateFileOf(roots[1], 'A%%Sub')]: null,
    })
  })

  it('stamps the whole family of a rename and its new names', () => {
    const { roots } = twoRoots({ internal: ['A', 'A%%B'] })
    expect(seratoEditFiles(rename('A', 'X'), roots)).toEqual({
      [crateFileOf(roots[0], 'A')]: { tracks: ['Users/dj/internal/A.mp3'] },
      [crateFileOf(roots[0], 'A%%B')]: { tracks: ['Users/dj/internal/A%%B.mp3'] },
      [crateFileOf(roots[0], 'X')]: null,
      [crateFileOf(roots[0], 'X%%B')]: null,
    })
  })

  it('does not expect the new name of a change of case to be missing, since it is the same file', () => {
    const { roots } = twoRoots({ internal: ['house'] })
    expect(Object.keys(seratoEditFiles(rename('house', 'House'), roots))).toEqual([
      crateFileOf(roots[0], 'house'),
    ])
  })

  it('stamps no crate for a track edit, whose link ids carry the rows the user saw', () => {
    const { roots } = twoRoots({ internal: ['A'], gig: ['A'] })
    expect(seratoEditFiles({ kind: 'remove', playlistId: 'A', linkIds: [] }, roots)).toEqual({})
    expect(seratoEditFiles({ kind: 'add', playlistId: 'A', tracks: [] }, roots)).toEqual({})
  })
})
