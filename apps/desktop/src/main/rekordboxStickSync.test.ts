import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openRekordboxDb } from './rekordboxDb'
import { writeRekordboxExportFixture } from './rekordboxExportFixture'
import {
  nodeTimestamps,
  readMasterIdentity,
  signedInt32,
  stickDeviceIds,
  syncedPlaylists,
  syncFileText,
} from './rekordboxStickSync'

const BASES = { id: '1401397687', parentId: 'root', folder: true }
const MAKINA = { id: '3965545314', parentId: '1401397687', folder: false }

// rekordbox 7.2.19 wrote exactly these 529 bytes on the test stick, and the coexistence run
// regenerated them byte for byte from master.db and masterPlaylists6.xml (18/10/2026). Any
// difference is a stick rekordbox may not recognise as synced.
const REKORDBOX_SYNC = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '',
  '<Sync DBID="-352658652" AutomaticSync="1" AllPlaylists="0" IncludeCue="1" ForcedSync="0" Timestamp="0">',
  '  <Playlists>',
  '    <NODE Id="0" ParentId="0" Attribute="1" Lib_Type="0" Dev_ID="0" Timestamp="0" CheckType="2"/>',
  '    <NODE Id="5387A1B7" ParentId="0" Attribute="1" Lib_Type="0" Dev_ID="1" Timestamp="1787178676095" CheckType="2"/>',
  '    <NODE Id="EC5D6B62" ParentId="5387A1B7" Attribute="0" Lib_Type="0" Dev_ID="2" Timestamp="1792349372735" CheckType="1"/>',
  '  </Playlists>',
  '</Sync>',
  '',
].join('\r\n')

describe('syncFileText', () => {
  it('writes the file rekordbox writes, byte for byte', () => {
    const text = syncFileText(
      3942308644,
      [BASES, MAKINA],
      new Map([
        [BASES.id, 1],
        [MAKINA.id, 2],
      ]),
      new Map([
        ['5387A1B7', 1787178676095],
        ['EC5D6B62', 1792349372735],
      ]),
      new Map(),
    )
    expect(text).toBe(REKORDBOX_SYNC)
    expect(Buffer.byteLength(text)).toBe(529)
  })

  // A playlist created after masterPlaylists6.xml was last read has no node yet; its
  // updated_at is the best stand-in (rekordbox itself once wrote it there).
  it('falls back to updated_at when the node is not in masterPlaylists6.xml', () => {
    const text = syncFileText(
      3942308644,
      [BASES, MAKINA],
      new Map([
        [BASES.id, 1],
        [MAKINA.id, 2],
      ]),
      new Map(),
      new Map([[MAKINA.id, 1790869744796]]),
    )
    expect(text).toContain(
      'Id="EC5D6B62" ParentId="5387A1B7" Attribute="0" Lib_Type="0" Dev_ID="2" Timestamp="1790869744796" CheckType="1"',
    )
  })
})

describe('signedInt32', () => {
  it('reads the DBID as rekordbox prints it', () => {
    expect(signedInt32(3942308644)).toBe(-352658652)
    expect(signedInt32(12345)).toBe(12345)
  })
})

describe('stickDeviceIds', () => {
  // rekordbox maps its playlists to the stick's through these ids: renumbering them on a
  // re-export would point its sync state at other playlists.
  it('keeps the ids the stick already has and gives new nodes the next ones in tree order', () => {
    const NEW = { id: '200', parentId: 'root', folder: false }
    const ids = stickDeviceIds([BASES, NEW, MAKINA], REKORDBOX_SYNC)
    expect(ids.get(BASES.id)).toBe(1)
    expect(ids.get(MAKINA.id)).toBe(2)
    expect(ids.get(NEW.id)).toBe(3)
  })

  it('numbers 1..N in tree order on a stick without a sync file', () => {
    expect([...stickDeviceIds([BASES, MAKINA], null).values()]).toEqual([1, 2])
  })

  // A playlist on the stick that this export leaves out still owns its id there: a new
  // playlist taking it would be the same playlist to rekordbox.
  it('never hands a new node an id a playlist left out of this export still has', () => {
    const NEW = { id: '200', parentId: 'root', folder: false }
    const ids = stickDeviceIds([BASES, NEW], REKORDBOX_SYNC)
    expect(ids.get(BASES.id)).toBe(1)
    expect(ids.get(NEW.id)).toBe(3)
  })

  // baken refuses a new id past u32::MAX; Surco must say so before running it.
  it('refuses when no id is left after the stick highest', () => {
    const full = REKORDBOX_SYNC.replace('Dev_ID="2"', 'Dev_ID="4294967295"')
    expect(() =>
      stickDeviceIds([BASES, MAKINA, { id: '200', parentId: 'root', folder: false }], full),
    ).toThrow()
  })
})

describe('nodeTimestamps', () => {
  it('reads each node by its own Id, never by its ParentId', () => {
    const xml = [
      '    <NODE Id="EC5D6B62" ParentId="5387A1B7" Attribute="0" Timestamp="1792349372735" Lib_Type="0" CheckType="0"/>',
      '    <NODE Id="5387A1B7" ParentId="0" Attribute="1" Timestamp="1787178676095" Lib_Type="0" CheckType="0"/>',
    ].join('\r\n')
    expect(nodeTimestamps(xml)).toEqual(
      new Map([
        ['EC5D6B62', 1792349372735],
        ['5387A1B7', 1787178676095],
      ]),
    )
  })

  // Every node rekordbox wrote on 18/10 starts with a hex Id, so only a node with some other
  // Id (the file keeps nodes the database no longer has) can tell the two readings apart.
  it('never takes a stamp for the parent of a node whose Id it cannot read', () => {
    const xml = [
      '    <NODE Id="5387A1B7" ParentId="0" Attribute="1" Timestamp="1787178676095" Lib_Type="0" CheckType="0"/>',
      '    <NODE Id="itunes-1" ParentId="5387A1B7" Attribute="0" Timestamp="5" Lib_Type="1" CheckType="0"/>',
    ].join('\r\n')
    expect(nodeTimestamps(xml).get('5387A1B7')).toBe(1787178676095)
  })
})

describe('syncedPlaylists', () => {
  it('lists the ticked playlists by their master id, not the folders', () => {
    expect(syncedPlaylists(REKORDBOX_SYNC)).toEqual(['3965545314'])
  })
})

describe('readMasterIdentity', () => {
  // Measured on Vicent's collection (18/10): the cloud property table holds the SyncService
  // row OneLibrary names and a CDPFilterVersion row; picking "the only row" picks wrong.
  it('reads the identity rekordbox puts on its own sticks', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'stick-identity-')), 'master.db')
    writeRekordboxExportFixture(path, {
      content: [
        {
          ID: '101',
          FolderPath: '/m/a.wav',
          FileType: 11,
          FileSize: 53680358,
          Title: 'A',
          Length: 1,
        },
        {
          ID: '102',
          FolderPath: '/m/b.wav',
          FileType: 11,
          FileSize: 41000000,
          Title: 'B',
          Length: 1,
        },
      ],
      keys: [],
      playlists: [],
      links: [],
      dbId: '3942308644',
      cloudProperties: [
        { ID: '3436966042', Reserved1: 'CDPFilterVersion', Reserved2: '' },
        { ID: '4278116378', Reserved1: 'SyncService', Reserved2: 'Google' },
      ],
      myTags: [
        { ID: '2170819288', Seq: 1, Name: 'Acid House', Attribute: 0, ParentID: '1' },
        { ID: '1', Seq: 10001, Name: 'Genre', Attribute: 1, ParentID: 'root' },
        { ID: '77', Seq: 2, Name: 'Gone', Attribute: 0, ParentID: '1', deleted: true },
      ],
    })
    const db = openRekordboxDb(path, { readonly: true })
    if (!db) throw new Error('fixture did not open')
    try {
      expect(readMasterIdentity(db, ['101'])).toEqual({
        dbId: 3942308644,
        myTagMasterDbId: 4278116378,
        myTags: [
          { id: 1, seq: 10000, name: 'Genre', attribute: 1, parent: 0 },
          { id: 2170819288, seq: 0, name: 'Acid House', attribute: 0, parent: 1 },
        ],
        fileSizes: { '101': 53680358 },
      })
    } finally {
      db.close()
    }
  })
})
