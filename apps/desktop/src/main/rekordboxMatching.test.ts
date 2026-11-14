import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MATCHING_ID } from '../shared/matching'
import { openRekordboxDb } from './rekordboxDb'
import { readMatchingCount, readMatchingPairs } from './rekordboxMatching'
import { readRekordboxPlaylistWithPreview } from './rekordboxPlaylists'
import { type PlaylistFixture, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'

const track = (ID: string, Title: string, extra: object = {}) => ({
  ID,
  FolderPath: `/Music/${Title}.wav`,
  FileType: 11,
  Title,
  Length: 300,
  ...extra,
})

async function open(over: Partial<PlaylistFixture>) {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-rbmatch-')), 'master.db')
  writeRekordboxPlaylistFixture(path, { content: [], keys: [], playlists: [], links: [], ...over })
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error('fixture did not open')
  return db
}

const LET = track('185256960', 'Let Yourself Go')
const TAKE = track('172293251', 'Take Me Home')
const ACID = track('300', 'Acid Groove')
const QUE = track('400', 'Que Idea')
const EYES = track('500', 'In My Eyes')

describe('readMatchingPairs', () => {
  it('reads each pair the DJ marked with the Matching button, in deck order', async () => {
    const db = await open({
      content: [LET, TAKE],
      matches: [{ ContentID1: LET.ID, ContentID2: TAKE.ID }],
    })
    expect(readMatchingPairs(db)).toEqual([[LET.ID, TAKE.ID]])
  })

  it('skips a pair whose track was removed from the collection, so no ghost rows appear', async () => {
    const db = await open({
      content: [LET, { ...TAKE, deleted: true }],
      matches: [{ ContentID1: LET.ID, ContentID2: TAKE.ID }],
    })
    expect(readMatchingPairs(db)).toEqual([])
  })

  it('skips a pair flagged deleted, in case a synced collection marks rows instead of removing them', async () => {
    const db = await open({
      content: [LET, TAKE],
      matches: [{ ContentID1: LET.ID, ContentID2: TAKE.ID, deleted: true }],
    })
    expect(readMatchingPairs(db)).toEqual([])
  })

  it('reads nothing from a collection without the Matching table instead of failing the source', async () => {
    const db = await open({ content: [LET], noMatchingTable: true })
    expect(readMatchingPairs(db)).toEqual([])
    expect(readMatchingCount(db)).toBe(0)
  })
})

describe('the Matching entry of the rekordbox source', () => {
  const fixture = {
    content: [LET, TAKE, ACID, QUE, EYES],
    matches: [
      { ContentID1: QUE.ID, ContentID2: EYES.ID },
      { ContentID1: LET.ID, ContentID2: TAKE.ID },
      { ContentID1: TAKE.ID, ContentID2: ACID.ID },
    ],
  }

  it('counts the tracks with at least one partner', async () => {
    expect(readMatchingCount(await open(fixture))).toBe(5)
  })

  it('lists the tracks chain by chain with a separator between chains, longest chain first', async () => {
    const rows = readRekordboxPlaylistWithPreview(
      await open(fixture),
      '/share',
      MATCHING_ID,
      () => false,
    )
    expect(rows.map((r) => (r.separator ? '|' : r.preview?.title))).toEqual([
      'Acid Groove',
      'Take Me Home',
      'Let Yourself Go',
      '|',
      'In My Eyes',
      'Que Idea',
    ])
  })

  it('opens empty for a DJ who never pressed the Matching button', async () => {
    const db = await open({ content: [LET] })
    expect(readRekordboxPlaylistWithPreview(db, '/share', MATCHING_ID, () => false)).toEqual([])
  })

  it('keeps each row tied to its rekordbox track so the list can open, play and edit it', async () => {
    const rows = readRekordboxPlaylistWithPreview(
      await open(fixture),
      '/share',
      MATCHING_ID,
      () => false,
    )
    expect(rows[0]).toMatchObject({ path: ACID.FolderPath, contentId: ACID.ID, separator: false })
  })
})
