import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./seratoCuesWrite', () => ({ applySeratoCuesBatch: vi.fn() }))

import type { RekordboxPlaylistEdit } from '../shared/types'
import type { RekordboxMeta } from './rekordboxMetadata'
import type { TagsOp, TrackOp } from './rekordboxQueueOps'
import { applySeratoLibraryOps } from './seratoBatch'
import { applySeratoTags, applySeratoTrack, seratoEditFiles } from './seratoCrateEdits'
import { crateFileOf, crateTrackPaths, seratoLinkId } from './seratoCrateFile'
import { parseSeratoDatabase } from './seratoDatabase'
import { concat, frame, track, utf16be } from './seratoDatabaseFixture'
import type { SeratoLibraryRoot } from './seratoLibrary'
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
import { createSeratoDraft, type SeratoDraft } from './seratoLibraryWrite'

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

const moveNode = (playlistId: string, parentId: string): RekordboxPlaylistEdit => ({
  kind: 'moveNode',
  playlistId,
  parentId,
  beforeId: null,
})

describe('moving a crate', () => {
  it('moves a crate and its subcrates under another crate in every root, keeping their bytes', async () => {
    const { roots, deps, bytes } = twoRoots({
      internal: ['A', 'A%%B', 'A%%B%%C', 'D'],
      gig: ['A%%B'],
    })
    const outcome = await apply(roots, deps, moveNode('A%%B', 'D'))
    expect(outcome.applied).toBe(true)
    expect(readFileSync(crateFileOf(roots[0], 'D%%B%%C'))).toEqual(bytes.internal['A%%B%%C'])
    expect(existsSync(crateFileOf(roots[1], 'D%%B'))).toBe(true)
    expect(listCrates(roots[0])).toEqual(['A.crate', 'D%%B%%C.crate', 'D%%B.crate', 'D.crate'])
  })

  it('moves a subcrate to the root', async () => {
    const { roots, deps } = twoRoots({ internal: ['A', 'A%%B'] })
    await apply(roots, deps, moveNode('A%%B', 'root'))
    expect(listCrates(roots[0])).toEqual(['A.crate', 'B.crate'])
  })

  it('ignores the position asked for, since Serato lists crates by name', async () => {
    const { roots, deps } = twoRoots({ internal: ['A', 'B'] })
    const outcome = await apply(roots, deps, {
      kind: 'moveNode',
      playlistId: 'B',
      parentId: 'root',
      beforeId: 'A',
    })
    expect(outcome.applied).toBe(true)
    expect(listCrates(roots[0])).toEqual(['A.crate', 'B.crate'])
  })

  it('refuses a move into itself, into its own subcrate, onto a name the destination already has, or under a crate that is gone', async () => {
    const { roots, deps } = twoRoots({ internal: ['A', 'A%%B', 'D', 'D%%B'] })
    expect(await apply(roots, deps, moveNode('A', 'A'))).toMatchObject({
      applied: false,
      reason: 'stale',
    })
    expect(await apply(roots, deps, moveNode('A', 'A%%B'))).toMatchObject({
      applied: false,
      reason: 'stale',
    })
    expect(await apply(roots, deps, moveNode('A%%B', 'D'))).toMatchObject({
      applied: false,
      reason: 'bad-name',
    })
    expect(await apply(roots, deps, moveNode('A%%B', 'Z'))).toMatchObject({
      applied: false,
      reason: 'stale',
    })
  })

  it('refuses to move a family Serato cannot read back', async () => {
    const { roots, deps } = twoRoots({ internal: ['A', 'A%%B', 'D'] })
    writeFileSync(crateFileOf(roots[0], 'A%%B'), Buffer.from('vrsn\0\0\x01\0'))
    expect(await apply(roots, deps, moveNode('A', 'D'))).toMatchObject({
      applied: false,
      reason: 'unreadable',
    })
  })

  it('stamps the family it will rename and claims the new paths, so a crate Serato touched meanwhile refuses it', () => {
    const { roots } = twoRoots({ internal: ['A', 'A%%B', 'D'] })
    const files = seratoEditFiles(moveNode('A%%B', 'D'), roots)
    expect(files[crateFileOf(roots[0], 'A%%B')]).toEqual({
      tracks: ['Users/dj/internal/A%%B.mp3'],
    })
    expect(files[crateFileOf(roots[0], 'D%%B')]).toBeNull()
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

const NOW = new Date('2026-11-04T10:00:00Z')
const NOW_S = Math.floor(NOW.getTime() / 1000)
const META: RekordboxMeta = {
  title: 'Pray',
  artist: 'Tina Cousins',
  album: 'Pray',
  albumArtist: '',
  genre: 'Electronic',
  label: '',
  remixer: '',
  comment: '',
  year: '',
  trackNumber: '',
  discNumber: '',
}
const VRSN = frame('vrsn', utf16be('2.0/Serato Scratch LIVE Database'))
const dbOf = (root: SeratoLibraryRoot): string => join(root.dir, 'database V2')

function seratoWith(
  paths: string[],
  crates: {
    internal?: (string | [string, string[]])[]
    gig?: string[]
    truncated?: string[]
  } = {
    internal: ['A'],
    gig: ['OnlyGig'],
  },
) {
  const { roots, deps, bytes } = twoRoots(crates)
  for (const r of roots)
    writeFileSync(
      dbOf(r),
      concat([VRSN, ...(r === roots[0] ? paths : []).map((pfil) => track({ ttyp: 'mp3', pfil }))]),
    )
  return { roots, deps, bytes, draft: createSeratoDraft() }
}

let nextTrack = 0
const trackOp = (fields: Partial<TrackOp> & { path: string }): TrackOp => ({
  id: `t${++nextTrack}`,
  kind: 'track',
  label: basename(fields.path),
  facts: null,
  wanted: [],
  known: [],
  stamps: {},
  ...fields,
})

const tracksIn = (draft: SeratoDraft, file: string): string[] =>
  crateTrackPaths(draft.read(file) ?? new Uint8Array()) ?? []

describe('a converted track in Serato', () => {
  it('adds a converted file Serato does not have to the database of its volume', () => {
    const { roots, draft } = seratoWith(['Users/dj/a.mp3'])
    const outcome = applySeratoTrack(
      draft,
      trackOp({ path: '/Users/dj/new.aiff', add: true, meta: META }),
      roots,
      NOW,
    )
    expect(outcome.applied).toBe(true)
    expect(
      parseSeratoDatabase(draft.read(dbOf(roots[0])) ?? new Uint8Array()).at(-1),
    ).toMatchObject({ path: 'Users/dj/new.aiff', title: META.title, addedAt: NOW_S })
  })

  it('does not add a file the database already holds under another normalization', () => {
    const { roots, draft } = seratoWith(['Users/dj/Música/a.mp3'.normalize('NFD')])
    applySeratoTrack(
      draft,
      trackOp({ path: '/Users/dj/Música/a.mp3'.normalize('NFC'), add: true, meta: META }),
      roots,
      NOW,
    )
    expect(parseSeratoDatabase(draft.read(dbOf(roots[0])) ?? new Uint8Array())).toHaveLength(1)
  })

  it('puts the converted file in the crates the conversion chose', () => {
    const { roots, draft } = seratoWith(['Users/dj/a.mp3'])
    applySeratoTrack(
      draft,
      trackOp({ path: '/Users/dj/a.mp3', wanted: [{ id: 'A', name: 'A' }, { name: 'Nuevo' }] }),
      roots,
      NOW,
    )
    expect(tracksIn(draft, crateFileOf(roots[0], 'A'))).toContain('Users/dj/a.mp3')
    expect(tracksIn(draft, crateFileOf(roots[0], 'Nuevo'))).toEqual(['Users/dj/a.mp3'])
  })

  it('warns instead of adding to a crate on another drive', () => {
    const { roots, draft, bytes } = seratoWith(['Users/dj/a.mp3'])
    expect(
      applySeratoTrack(
        draft,
        trackOp({ path: '/Users/dj/a.mp3', wanted: [{ id: 'OnlyGig', name: 'OnlyGig' }] }),
        roots,
        NOW,
      ).notices,
    ).toEqual([{ code: 'other-volume', track: 'a.mp3', playlist: 'OnlyGig' }])
    expect(Buffer.from(draft.read(crateFileOf(roots[1], 'OnlyGig')) ?? [])).toEqual(
      bytes.gig.OnlyGig,
    )
    expect(draft.changes().writes).toEqual([])
  })

  it('does not add a file whose crate picks all live on another drive, since the user asked only for a crate it cannot get', () => {
    const { roots, draft } = seratoWith([])
    const outcome = applySeratoTrack(
      draft,
      trackOp({
        path: '/Users/dj/a.mp3',
        meta: META,
        wanted: [{ id: 'OnlyGig', name: 'OnlyGig' }],
      }),
      roots,
      NOW,
    )
    expect(outcome).toMatchObject({
      applied: true,
      uncounted: true,
      notices: [{ code: 'other-volume', track: 'a.mp3', playlist: 'OnlyGig' }],
    })
    expect(draft.changes().writes).toEqual([])
  })

  it('adds a new file without touching crates that already list it when the conversion only asked to add it', () => {
    const { roots, draft } = seratoWith([], { internal: [['Old', ['Users/dj/new.mp3']]] })
    const outcome = applySeratoTrack(
      draft,
      trackOp({ path: '/Users/dj/new.mp3', add: true, meta: META }),
      roots,
      NOW,
    )
    expect(outcome).toEqual({ id: outcome.id, applied: true, notices: [] })
  })

  it('raises nothing for an add when Serato picked the file up into its crates before the queue applied', () => {
    const { roots, draft } = seratoWith(['Users/dj/new.mp3'], {
      internal: [['Old', ['Users/dj/new.mp3']]],
    })
    const outcome = applySeratoTrack(
      draft,
      trackOp({ path: '/Users/dj/new.mp3', add: true, meta: META }),
      roots,
      NOW,
    )
    expect(outcome).toEqual({ id: outcome.id, applied: true, notices: [] })
    expect(draft.changes().writes).toEqual([])
  })

  it('says a chosen crate changed in Serato when Surco cannot read it back', () => {
    const { roots, draft } = seratoWith(['Users/dj/a.mp3'], { internal: ['A'], truncated: ['A'] })
    expect(
      applySeratoTrack(
        draft,
        trackOp({ path: '/Users/dj/a.mp3', wanted: [{ id: 'A', name: 'A' }] }),
        roots,
        NOW,
      ).notices,
    ).toEqual([{ code: 'playlist-changed', track: 'a.mp3', playlist: 'A' }])
  })

  it('does not list the file twice in a crate that already holds it', () => {
    const { roots, draft } = seratoWith(['Users/dj/a.mp3'], {
      internal: [['A', ['Users/dj/a.mp3']]],
    })
    applySeratoTrack(
      draft,
      trackOp({ path: '/Users/dj/a.mp3', wanted: [{ id: 'A', name: 'A' }], known: ['A'] }),
      roots,
      NOW,
    )
    expect(tracksIn(draft, crateFileOf(roots[0], 'A'))).toEqual(['Users/dj/a.mp3'])
  })

  it('says a chosen crate is gone when no drive has it any more', () => {
    const { roots, draft } = seratoWith(['Users/dj/a.mp3'])
    expect(
      applySeratoTrack(
        draft,
        trackOp({ path: '/Users/dj/a.mp3', wanted: [{ id: 'Gone', name: 'Gone' }] }),
        roots,
        NOW,
      ).notices,
    ).toEqual([{ code: 'playlist-gone', track: 'a.mp3', playlist: 'Gone' }])
  })

  it('says a file on a drive with no Serato library cannot go in the chosen crates, rather than only that it was not added', () => {
    const { roots, draft } = seratoWith(['Users/dj/a.mp3'])
    const outcome = applySeratoTrack(
      draft,
      trackOp({ path: '/Volumes/Other/a.mp3', wanted: [{ id: 'A', name: 'A' }, { name: 'New' }] }),
      roots,
      NOW,
    )
    expect(outcome).toMatchObject({
      applied: false,
      notices: [
        { code: 'other-volume', track: 'a.mp3', playlist: 'A' },
        { code: 'other-volume', track: 'a.mp3', playlist: 'New' },
      ],
    })
    expect(draft.changes().writes).toEqual([])
  })

  it('skips a format Serato does not take', () => {
    const { roots, draft } = seratoWith(['Users/dj/a.mp3'])
    expect(
      applySeratoTrack(
        draft,
        trackOp({ path: '/Users/dj/a.ogg', add: true, meta: META }),
        roots,
        NOW,
      ).notices[0].code,
    ).toBe('not-added')
  })

  it('adds a file Serato does not have when the conversion chose crates for it, since a crate row needs its database entry', () => {
    const { roots, draft } = seratoWith([])
    applySeratoTrack(
      draft,
      trackOp({ path: '/Users/dj/a.mp3', meta: META, wanted: [{ id: 'A', name: 'A' }] }),
      roots,
      NOW,
    )
    expect(parseSeratoDatabase(draft.read(dbOf(roots[0])) ?? new Uint8Array())).toMatchObject([
      { path: 'Users/dj/a.mp3' },
    ])
    expect(tracksIn(draft, crateFileOf(roots[0], 'A'))).toContain('Users/dj/a.mp3')
  })

  it('leaves the crates alone when it cannot add the file, so no crate names a track Serato does not know', () => {
    const { roots, draft } = seratoWith([])
    const outcome = applySeratoTrack(
      draft,
      trackOp({ path: '/Users/dj/a.mp3', wanted: [{ id: 'A', name: 'A' }] }),
      roots,
      NOW,
    )
    expect(outcome.notices).toEqual([{ code: 'not-added', track: 'a.mp3' }])
    expect(tracksIn(draft, crateFileOf(roots[0], 'A'))).toEqual(['Users/dj/internal/A.mp3'])
  })

  it('does not add the output when Serato already has the source', () => {
    const { roots, draft } = seratoWith(['Users/dj/a.mp3'])
    const outcome = applySeratoTrack(
      draft,
      trackOp({
        path: '/Users/dj/a.aiff',
        from: '/Users/dj/a.mp3',
        add: true,
        meta: META,
        wanted: [{ id: 'A', name: 'A' }],
      }),
      roots,
      NOW,
    )
    expect(parseSeratoDatabase(draft.read(dbOf(roots[0])) ?? new Uint8Array())).toHaveLength(1)
    expect(tracksIn(draft, crateFileOf(roots[0], 'A'))).toEqual(['Users/dj/internal/A.mp3'])
    expect(outcome).toMatchObject({
      applied: true,
      uncounted: true,
      notices: [{ code: 'source-in-serato', track: 'a.aiff', playlist: 'A' }],
    })
  })

  it('clears the crate picks of a conversion whose source Serato keeps, once the queue applies it', async () => {
    const { deps } = seratoWith(['Users/dj/a.mp3'])
    const queued = trackOp({
      path: '/Users/dj/a.aiff',
      from: '/Users/dj/a.mp3',
      meta: META,
      wanted: [{ id: 'A', name: 'A' }],
    })
    const result = await applySeratoLibraryOps([queued], {
      ...deps,
      ensureClosed: async () => true,
    })
    expect(result).toMatchObject({ ok: true, outcomes: [{ applied: true }] })
  })

  it('takes the file out of a crate the user deselected, and leaves one Serato filled since', () => {
    const { roots, draft } = seratoWith(['Users/dj/a.mp3'], {
      internal: [
        ['Old', ['Users/dj/a.mp3']],
        ['Other', ['Users/dj/a.mp3']],
      ],
    })
    const outcome = applySeratoTrack(
      draft,
      trackOp({ path: '/Users/dj/a.mp3', known: ['Old'] }),
      roots,
      NOW,
    )
    expect(tracksIn(draft, crateFileOf(roots[0], 'Old'))).toEqual([])
    expect(tracksIn(draft, crateFileOf(roots[0], 'Other'))).toEqual(['Users/dj/a.mp3'])
    expect(outcome.notices).toEqual([
      { code: 'playlist-changed', track: 'a.mp3', playlist: 'Other' },
    ])
  })

  it('keeps a parent crate byte for byte when the picks add a crate elsewhere, since the field lists the parent as a pick', () => {
    const { roots, draft } = seratoWith(['Users/dj/a.mp3'], {
      internal: [
        ['House', ['Users/dj/a.mp3']],
        ['House%%Deep', ['Users/dj/a.mp3']],
      ],
    })
    const house = crateFileOf(roots[0], 'House')
    const before = Buffer.from(draft.read(house) ?? [])
    const outcome = applySeratoTrack(
      draft,
      trackOp({
        path: '/Users/dj/a.mp3',
        known: ['House', 'House%%Deep'],
        wanted: [
          { id: 'House', name: 'House' },
          { id: 'House%%Deep', name: 'Deep' },
          { name: 'Techno' },
        ],
      }),
      roots,
      NOW,
    )
    expect(Buffer.from(draft.read(house) ?? [])).toEqual(before)
    expect(tracksIn(draft, crateFileOf(roots[0], 'Techno'))).toEqual(['Users/dj/a.mp3'])
    expect(outcome.notices).toEqual([])
  })

  it('takes the file out of a parent crate the user deselected, like any other crate', () => {
    const { roots, draft } = seratoWith(['Users/dj/a.mp3'], {
      internal: [
        ['House', ['Users/dj/a.mp3']],
        ['House%%Deep', ['Users/dj/a.mp3']],
      ],
    })
    applySeratoTrack(
      draft,
      trackOp({
        path: '/Users/dj/a.mp3',
        known: ['House', 'House%%Deep'],
        wanted: [{ id: 'House%%Deep', name: 'Deep' }],
      }),
      roots,
      NOW,
    )
    expect(tracksIn(draft, crateFileOf(roots[0], 'House'))).toEqual([])
    expect(tracksIn(draft, crateFileOf(roots[0], 'House%%Deep'))).toEqual(['Users/dj/a.mp3'])
  })

  it('adds the converted file through the queue after the crate edits of the same batch', async () => {
    const { roots, deps } = seratoWith(['Users/dj/a.mp3'], { internal: [] })
    const result = await applySeratoLibraryOps(
      [
        trackOp({ path: '/Users/dj/a.mp3', wanted: [{ id: 'Fresh', name: 'Fresh' }] }),
        editOp(create('root', 'Fresh')),
      ],
      { ...deps, ensureClosed: async () => true },
    )
    expect(result).toMatchObject({ ok: true, outcomes: [{ applied: true }, { applied: true }] })
    expect(crateTrackPaths(readFileSync(crateFileOf(roots[0], 'Fresh')))).toEqual([
      'Users/dj/a.mp3',
    ])
  })
})

describe('review tags in Serato', () => {
  const PRAY = '/Users/vicent/Music/Serato Pruebas/Pray.aiff'
  const PRAY_PFIL = 'Users/vicent/Music/Serato Pruebas/Pray.aiff'
  const tagsOp = (path: string, fields: TagsOp['fields'], from?: TagsOp['from']): TagsOp => ({
    id: 't',
    kind: 'tags',
    path,
    label: basename(path),
    fields,
    ...(from ? { from } : {}),
  })

  function prayInSerato() {
    const { roots, draft } = seratoWith([])
    const other = track({ ttyp: 'mp3', pfil: 'Users/dj/a.mp3', tsng: 'A' })
    writeFileSync(
      dbOf(roots[0]),
      concat([
        VRSN,
        track({ ttyp: 'aiff', pfil: PRAY_PFIL, tsng: 'Pray (old)', tbpm: '128', tcom: 'kept' }),
        other,
      ]),
    )
    return { roots, draft, other }
  }

  it('changes title, artist, album and genre of the track Serato has at that path, and nothing else', () => {
    const { roots, draft, other } = prayInSerato()
    const op = tagsOp(
      PRAY,
      { tsng: 'Pray', tart: 'Tina', talb: 'P', tgen: 'House' },
      { tsng: 'Pray (old)', tart: '', talb: '', tgen: '' },
    )
    expect(applySeratoTags(draft, op, roots).applied).toBe(true)
    const tracks = parseSeratoDatabase(draft.read(dbOf(roots[0])) ?? new Uint8Array())
    expect(tracks[0]).toMatchObject({
      title: 'Pray',
      artist: 'Tina',
      album: 'P',
      genre: 'House',
      bpm: '128',
      path: PRAY_PFIL,
    })
    const bytes = Buffer.from(draft.read(dbOf(roots[0])) ?? [])
    expect(bytes.includes(Buffer.from(frame('tcom', utf16be('kept'))))).toBe(true)
    expect(bytes.subarray(bytes.length - other.length)).toEqual(Buffer.from(other))
  })

  it('says Serato does not have a track it cannot find, and writes nothing', () => {
    const { roots, draft } = prayInSerato()
    expect(applySeratoTags(draft, tagsOp('/Users/dj/x.mp3', { tsng: 'X' }), roots)).toEqual({
      id: 't',
      applied: false,
      notices: [{ code: 'tags-not-in-library', track: 'x.mp3' }],
    })
    expect(draft.changes().writes).toEqual([])
  })

  it('says Serato does not have a track outside every Serato library', () => {
    const { draft } = prayInSerato()
    expect(applySeratoTags(draft, tagsOp(PRAY, { tsng: 'X' }), []).notices).toEqual([
      { code: 'tags-not-in-library', track: 'Pray.aiff' },
    ])
  })

  it('leaves a track whose title the user changed in Serato since the review, so their edit stays', () => {
    const { roots, draft } = prayInSerato()
    const before = Buffer.from(readFileSync(dbOf(roots[0])))
    const op = tagsOp(PRAY, { tsng: 'Pray', tart: 'Tina' }, { tsng: 'Pray (radio)', tart: '' })
    expect(applySeratoTags(draft, op, roots)).toEqual({
      id: 't',
      applied: false,
      notices: [{ code: 'tags-changed', track: 'Pray.aiff' }],
    })
    expect(draft.changes().writes).toEqual([])
    expect(Buffer.from(draft.read(dbOf(roots[0])) ?? [])).toEqual(before)
  })

  it('leaves the whole track when any one field changed in Serato, as rekordbox does', () => {
    const { roots, draft } = prayInSerato()
    const op = tagsOp(PRAY, { tsng: 'Pray', tgen: 'House' }, { tsng: 'Pray (old)', tgen: 'Trance' })
    expect(applySeratoTags(draft, op, roots).applied).toBe(false)
    expect(draft.changes().writes).toEqual([])
  })

  it('takes the old value in either Unicode form as the same', () => {
    const { roots, draft } = seratoWith([])
    writeFileSync(
      dbOf(roots[0]),
      concat([VRSN, track({ ttyp: 'aiff', pfil: PRAY_PFIL, tsng: 'Canción'.normalize('NFC') })]),
    )
    const op = tagsOp(PRAY, { tsng: 'Pray' }, { tsng: 'Canción'.normalize('NFD') })
    expect(applySeratoTags(draft, op, roots).applied).toBe(true)
  })

  it('writes a change queued before the old value was kept, since that queue has nothing to compare', () => {
    const { roots, draft } = prayInSerato()
    expect(applySeratoTags(draft, tagsOp(PRAY, { tsng: 'Pray' }), roots).applied).toBe(true)
    expect(parseSeratoDatabase(draft.read(dbOf(roots[0])) ?? new Uint8Array())[0].title).toBe(
      'Pray',
    )
  })

  it('tags a track through the queue after the converted track of the same batch was added', async () => {
    const { roots, deps } = seratoWith([], { internal: [] })
    const result = await applySeratoLibraryOps(
      [
        tagsOp('/Users/dj/new.aiff', { tgen: 'House' }),
        trackOp({ path: '/Users/dj/new.aiff', add: true, meta: META }),
      ],
      { ...deps, ensureClosed: async () => true },
    )
    expect(result).toMatchObject({ ok: true, outcomes: [{ applied: true }, { applied: true }] })
    expect(parseSeratoDatabase(readFileSync(dbOf(roots[0])))[0]).toMatchObject({
      path: 'Users/dj/new.aiff',
      genre: 'House',
    })
  })
})
