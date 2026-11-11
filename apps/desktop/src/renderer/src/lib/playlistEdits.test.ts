import { describe, expect, it } from 'vitest'
import type { RekordboxPlaylistEdit, SourceNode, SourcePlaylistEntry } from '../../../shared/types'
import i18n from '../i18n'
import {
  editedTree,
  editMessage,
  isPendingNode,
  moveBefore,
  movedCrateId,
  movedEntries,
  PENDING_NODE,
  reopenedPlaylist,
  subtreeCounts,
  subtreeIds,
} from './playlistEdits'

const row = (linkId: string): SourcePlaylistEntry => ({
  path: `/m/${linkId}.wav`,
  separator: false,
  meta: {},
  linkId,
})
const ENTRIES = ['a', 'b', 'c', 'd'].map(row)
const tr = i18n.getFixedT('en')

describe('moveBefore', () => {
  const same = (k: string): string => k
  // The writer's rule (rekordboxPlaylistEdit.moveInPlaylist), written once for the
  // renderer: the moved items keep their own order and land right before the target, every
  // other item keeps its place.
  it('lands the moved items before the target in their own order', () => {
    expect(moveBefore(['a', 'b', 'c', 'd'], same, new Set(['d', 'b']), 'a')).toEqual([
      'b',
      'd',
      'a',
      'c',
    ])
  })

  it('lands them at the end for a null target', () => {
    expect(moveBefore(['a', 'b', 'c'], same, new Set(['a']), null)).toEqual(['b', 'c', 'a'])
  })

  it('has no answer for a target that is gone or is itself moving', () => {
    expect(moveBefore(['a', 'b'], same, new Set(['a']), 'zz')).toBeNull()
    expect(moveBefore(['a', 'b'], same, new Set(['a']), 'a')).toBeNull()
  })
})

describe('movedEntries', () => {
  // The same rule the writer applies, so the row the user dropped stays where it landed
  // while rekordbox is written, and the re-read confirms it rather than moving it.
  it('moves the rows before the target, keeping everything else in order', () => {
    expect(movedEntries(ENTRIES, ['d', 'b'], 'a').map((e) => e.linkId)).toEqual([
      'b',
      'd',
      'a',
      'c',
    ])
    expect(movedEntries(ENTRIES, ['a'], null).map((e) => e.linkId)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('leaves the order alone when the target is gone', () => {
    expect(movedEntries(ENTRIES, ['a'], 'zz')).toBe(ENTRIES)
  })
})

describe('editMessage', () => {
  const add: RekordboxPlaylistEdit = { kind: 'add', playlistId: 'h', tracks: [] }

  // The usual failure line says the collection is as it was; when that is not known, the
  // user is told to put the copy back, which file it is and where Surco keeps it. This state comes from a -wal
  // that still holds frames: copied back beside it, SQLite would replay them over the copy,
  // so the -wal and -shm have to go aside first.
  it('says a queued edit will be written once the program closes, as a note and not an error', () => {
    const create: RekordboxPlaylistEdit = {
      kind: 'create',
      parentId: 'root',
      name: 'S',
      folder: false,
    }
    expect(editMessage(tr, create, { applied: false, queued: true, opId: 'op1' }, 'S')).toEqual({
      text: tr('sources.edit.refused.cancelled'),
      tone: 'neutral',
    })
  })

  it('tells the user to restore the copy when the collection state is unknown', () => {
    expect(editMessage(tr, add, { applied: false, reason: 'write-unknown' }, 'House')).toEqual({
      text: 'The change could not be saved or undone, so the collection may have changed. Before opening rekordbox, move master.db-wal and master.db-shm out of its folder and then replace master.db with the copy master.db.surco-backup you will find in Settings → Advanced → Collection backups',
      tone: 'danger',
    })
  })

  // An add that skips tracks without saying why reads as Surco losing them.
  it('says how many went in and why the rest did not', () => {
    expect(
      editMessage(
        tr,
        add,
        { applied: true, report: { added: 2, already: 1, notInCollection: 1, ambiguous: 1 } },
        'House',
      ),
    ).toEqual({
      text: "2 tracks added to “House”. 1 was already in the playlist. 1 is not in the rekordbox collection. 1 is in the collection twice and Surco can't tell which to use",
      tone: 'neutral',
    })
  })

  it('accepts only the message prefixes the source table declares', () => {
    // @ts-expect-error
    editMessage(tr, add, { applied: false, reason: 'write-unknown' }, 'House', 'traktor')
  })

  it('says a bad crate name in Serato words', () => {
    const rename: RekordboxPlaylistEdit = { kind: 'rename', playlistId: 'A', name: 'a/b' }
    expect(
      editMessage(tr, rename, { applied: false, reason: 'bad-name' }, 'A', 'sources.editSerato.')
        ?.text,
    ).toMatch(/crate/)
  })

  it('says nothing went in when nothing could', () => {
    expect(
      editMessage(
        tr,
        add,
        {
          applied: false,
          reason: 'nothing-to-add',
          report: { added: 0, already: 0, notInCollection: 3, ambiguous: 0 },
        },
        'House',
      )?.text,
    ).toBe('No tracks added to “House”. 3 are not in the rekordbox collection')
  })

  it('says the edit waits for rekordbox to close', () => {
    expect(
      editMessage(
        tr,
        { kind: 'remove', playlistId: 'f', linkIds: ['l1'] },
        { applied: false, reason: 'cancelled' },
        'Factory',
      ),
    ).toEqual({
      text: 'rekordbox is still open. The change will apply when you close it',
      tone: 'neutral',
    })
  })

  it('stays quiet for an edit the list already shows', () => {
    expect(
      editMessage(
        tr,
        { kind: 'move', playlistId: 'f', linkIds: ['a'], beforeLinkId: null },
        { applied: true },
        'F',
      ),
    ).toBeNull()
  })

  // The writer answers 'unreadable' both for a collection it cannot open and for an XML whose
  // layout cannot take a new node; the result cannot tell them apart, so the line must be
  // true for both and never claim Surco failed to read something it read fine.
  it('words an unreadable refusal so it also holds when the layout cannot take a node', () => {
    const text = editMessage(
      tr,
      { kind: 'create', parentId: 'root', name: 'New', folder: false },
      { applied: false, reason: 'unreadable' },
      'New',
    )?.text
    expect(text).toBe(
      "Surco can't change the rekordbox collection files right now, so nothing changed",
    )
    expect(text).not.toMatch(/read/i)
  })
})

describe('subtreeCounts', () => {
  it('counts every playlist and folder under a node', () => {
    expect(
      subtreeCounts({
        id: 'b',
        name: 'BASES',
        kind: 'folder',
        count: 2,
        children: [
          { id: 'p1', name: 'A', kind: 'playlist', count: 1 },
          {
            id: 'f1',
            name: 'F',
            kind: 'folder',
            count: 2,
            children: [
              { id: 'p2', name: 'B', kind: 'playlist', count: 1 },
              { id: 'p3', name: 'C', kind: 'playlist', count: 1 },
            ],
          },
        ],
      }),
    ).toEqual({ playlists: 3, folders: 1 })
  })
})

const leaf = (id: string): SourceNode => ({
  id,
  name: id,
  kind: 'playlist',
  count: 1,
})
const TREE: SourceNode[] = [
  {
    id: 'A',
    name: 'A',
    kind: 'folder',
    count: 0,
    children: [
      leaf('a1'),
      {
        id: 'A2',
        name: 'A2',
        kind: 'folder',
        count: 0,
        children: [leaf('a21')],
      },
    ],
  },
  leaf('b'),
  leaf('c'),
]

describe('editedTree', () => {
  it('draws a created playlist last in its parent with a pending id and no tracks', () => {
    const next = editedTree(TREE, {
      kind: 'create',
      parentId: 'A',
      name: 'New',
      folder: false,
    })
    const created = next?.[0].children?.at(-1)
    expect(created).toMatchObject({ name: 'New', kind: 'playlist', count: 0 })
    expect(created?.children).toBeUndefined()
    expect(isPendingNode(created?.id ?? '')).toBe(true)
    expect(created?.id.startsWith(PENDING_NODE)).toBe(true)
  })
  it('draws a created folder with an empty children list, so it can open', () => {
    const next = editedTree(TREE, {
      kind: 'create',
      parentId: 'root',
      name: 'F',
      folder: true,
    })
    expect(next?.at(-1)).toMatchObject({
      name: 'F',
      kind: 'folder',
      count: 0,
      children: [],
    })
  })
  it('renames in place', () => {
    expect(
      editedTree(TREE, { kind: 'rename', playlistId: 'a21', name: 'X' })?.[0].children?.[1]
        .children?.[0].name,
    ).toBe('X')
  })
  it('removes a deleted folder with everything inside', () => {
    expect(editedTree(TREE, { kind: 'delete', playlistId: 'A' })?.map((n) => n.id)).toEqual([
      'b',
      'c',
    ])
  })
  it('moves a node before the sibling named, into another parent', () => {
    const next = editedTree(TREE, {
      kind: 'moveNode',
      playlistId: 'c',
      parentId: 'A',
      beforeId: 'A2',
    })
    expect(next?.[0].children?.map((n) => n.id)).toEqual(['a1', 'c', 'A2'])
    expect(next?.map((n) => n.id)).toEqual(['A', 'b'])
  })
  it('moves a folder with its children to the end of the root', () => {
    const next = editedTree(TREE, {
      kind: 'moveNode',
      playlistId: 'A',
      parentId: 'root',
      beforeId: null,
    })
    expect(next?.map((n) => n.id)).toEqual(['b', 'c', 'A'])
    expect(next?.[2].children?.map((n) => n.id)).toEqual(['a1', 'A2'])
  })
  it('has no answer for a move into the node itself or its children, or onto a target that is gone', () => {
    expect(
      editedTree(TREE, {
        kind: 'moveNode',
        playlistId: 'A',
        parentId: 'A2',
        beforeId: null,
      }),
    ).toBeNull()
    expect(
      editedTree(TREE, {
        kind: 'moveNode',
        playlistId: 'A',
        parentId: 'A',
        beforeId: null,
      }),
    ).toBeNull()
    expect(
      editedTree(TREE, {
        kind: 'moveNode',
        playlistId: 'c',
        parentId: 'A',
        beforeId: 'nope',
      }),
    ).toBeNull()
  })
  it('has no answer for a node or parent that is gone', () => {
    expect(editedTree(TREE, { kind: 'rename', playlistId: 'nope', name: 'X' })).toBeNull()
    expect(editedTree(TREE, { kind: 'delete', playlistId: 'nope' })).toBeNull()
    expect(
      editedTree(TREE, {
        kind: 'create',
        parentId: 'nope',
        name: 'N',
        folder: false,
      }),
    ).toBeNull()
    expect(
      editedTree(TREE, {
        kind: 'moveNode',
        playlistId: 'nope',
        parentId: 'root',
        beforeId: null,
      }),
    ).toBeNull()
  })
  it('places a moved crate by name and renames it and its subcrates, as Serato will read them', () => {
    const crate = (id: string, children?: SourceNode[]): SourceNode => ({
      id,
      name: id.split('%%').at(-1) ?? id,
      kind: 'playlist',
      count: 0,
      ...(children ? { children } : {}),
    })
    const crates = [crate('A', [crate('A%%B', [crate('A%%B%%C')])]), crate('D', [crate('D%%E')])]
    const next = editedTree(
      crates,
      { kind: 'moveNode', playlistId: 'A%%B', parentId: 'D', beforeId: 'D%%E' },
      { crates: true },
    )
    expect(next?.[1].children?.map((n) => n.id)).toEqual(['D%%B', 'D%%E'])
    expect(next?.[1].children?.[0].children?.[0].id).toBe('D%%B%%C')
    expect(next?.[0].children).toEqual([])
  })
  it('leaves edits that do not change the tree alone', () => {
    expect(editedTree(TREE, { kind: 'add', playlistId: 'b', tracks: [] })).toBeNull()
  })
  it('never touches the tree it was given, because the cache still holds it', () => {
    const before = structuredClone(TREE)
    editedTree(TREE, {
      kind: 'moveNode',
      playlistId: 'c',
      parentId: 'A',
      beforeId: 'A2',
    })
    editedTree(TREE, { kind: 'rename', playlistId: 'a1', name: 'X' })
    editedTree(TREE, { kind: 'delete', playlistId: 'A' })
    editedTree(TREE, {
      kind: 'create',
      parentId: 'A',
      name: 'N',
      folder: true,
    })
    expect(TREE).toEqual(before)
  })
})

describe('subtreeIds', () => {
  it('lists the node and everything under it', () => {
    expect(subtreeIds(TREE, 'A')).toEqual(['A', 'a1', 'A2', 'a21'])
    expect(subtreeIds(TREE, 'nope')).toEqual([])
  })
})

describe('movedCrateId', () => {
  it('joins the last segment to the new parent, or stands alone at the root', () => {
    expect(movedCrateId('A%%B', 'D')).toBe('D%%B')
    expect(movedCrateId('A%%B', 'root')).toBe('B')
  })
})

describe('reopenedPlaylist', () => {
  const folder: SourceNode = { id: 'Sets', name: 'Sets', kind: 'folder', count: 1 }

  it('opens a list moved into another folder under the id it has there', () => {
    const list: SourceNode = { id: 'Sets/Friday', name: 'Friday', kind: 'playlist', count: 2 }
    expect(
      reopenedPlaylist(
        { id: 'Sets/Friday', name: 'Friday', folders: ['Sets'] },
        list,
        { id: 'Old/Friday', name: 'Friday', folders: ['Old'] },
        '/',
      ),
    ).toEqual({ node: { ...list, id: 'Old/Friday' }, folders: ['Old'] })
  })

  it('keeps open a list whose folder moved, under the folder’s new place', () => {
    expect(
      reopenedPlaylist(
        { id: 'Sets/Deep/Friday', name: 'Friday', folders: ['Sets', 'Deep'] },
        folder,
        { id: 'Old/Sets', name: 'Sets', folders: ['Old'] },
        '/',
      ),
    ).toEqual({
      node: { id: 'Old/Sets/Deep/Friday', name: 'Friday', kind: 'playlist', count: 0 },
      folders: ['Old', 'Sets', 'Deep'],
    })
  })

  it('leaves the open list alone when the moved node is not it or above it', () => {
    expect(
      reopenedPlaylist(
        { id: 'Setsx/Friday', name: 'Friday', folders: ['Setsx'] },
        folder,
        { id: 'Old/Sets', name: 'Sets', folders: ['Old'] },
        '/',
      ),
    ).toBeNull()
  })
})
