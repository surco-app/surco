import { describe, expect, it } from 'vitest'
import type { RekordboxPlaylistEdit, SourcePlaylistEntry } from '../../../shared/types'
import i18n from '../i18n'
import { editMessage, moveBefore, movedEntries, subtreeCounts } from './playlistEdits'

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
  // user is told to put the copy back, and which file it is. This state comes from a -wal
  // that still holds frames: copied back beside it, SQLite would replay them over the copy,
  // so the -wal and -shm have to go aside first.
  it('tells the user to restore the copy when the collection state is unknown', () => {
    expect(editMessage(tr, add, { applied: false, reason: 'write-unknown' }, 'House')).toEqual({
      text: 'The change could not be saved or undone, so the collection may have changed. Before opening rekordbox, move master.db-wal and master.db-shm out of its folder and then replace master.db with the copy master.db.surco-backup next to it',
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
