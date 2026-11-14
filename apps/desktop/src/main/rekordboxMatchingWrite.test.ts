import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openRekordboxDb } from './rekordboxDb'
import { readMatchingPairs } from './rekordboxMatching'
import { addMatching, removeMatching } from './rekordboxMatchingWrite'
import { type PlaylistFixture, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'

const track = (ID: string) => ({
  ID,
  FolderPath: `/Music/${ID}.wav`,
  FileType: 11,
  Title: ID,
  Length: 300,
})

async function open(over: Partial<PlaylistFixture> = {}) {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-rbmatchw-')), 'master.db')
  writeRekordboxPlaylistFixture(path, {
    content: [track('a'), track('b'), track('c')],
    keys: [],
    playlists: [],
    links: [],
    usn: 580815,
    ...over,
  })
  const db = openRekordboxDb(path)
  if (!db) throw new Error('fixture did not open')
  return db
}

const NOW = new Date('2026-11-14T09:38:19.337Z')

interface Row {
  ID: string
  UUID: string
  ContentID1: string
  ContentID2: string
  LikeRate: number | null
  DataCreatedH: number
  DataCreatedL: number
  rb_local_usn: number
  rb_local_deleted: number
  created_at: string
  updated_at: string
}

describe('addMatching', () => {
  // Measured on the row rekordbox 7 wrote for Let Yourself Go and Take Me Home (14/11).
  it('writes the pair the way rekordbox writes it, deck 1 first', async () => {
    const db = await open()
    addMatching(db, 'a', 'b', { now: NOW })
    const row = db.prepare('SELECT * FROM djmdRecommendLike').get() as Row
    expect(row).toMatchObject({
      ContentID1: 'a',
      ContentID2: 'b',
      LikeRate: null,
      DataCreatedH: 417,
      DataCreatedL: 3647736905,
      rb_local_usn: 580816,
      rb_local_deleted: 0,
      created_at: '2026-11-14 09:38:19.337 +00:00',
      updated_at: '2026-11-14 09:38:19.337 +00:00',
    })
    expect(row.ID).toMatch(/^[0-9a-f-]{36}$/)
    expect(row.UUID).toMatch(/^[0-9a-f-]{36}$/)
    expect(row.UUID).not.toBe(row.ID)
  })

  it('moves rekordbox change counter on, so rekordbox orders the new pair after its own changes', async () => {
    const db = await open()
    addMatching(db, 'a', 'b', { now: NOW })
    const counter = db
      .prepare(`SELECT int_1 FROM agentRegistry WHERE registry_id = 'localUpdateCount'`)
      .get() as { int_1: number }
    expect(counter.int_1).toBe(580816)
  })

  it('adds nothing when the two are already paired in either order', async () => {
    const db = await open({ matches: [{ ContentID1: 'b', ContentID2: 'a' }] })
    expect(addMatching(db, 'a', 'b', { now: NOW })).toBe(false)
    expect(readMatchingPairs(db)).toEqual([['b', 'a']])
  })
})

describe('removeMatching', () => {
  // rekordbox deletes the row when the button is pressed again; it does not flag it.
  it('deletes the pair whichever deck order it was stored in', async () => {
    const db = await open({
      matches: [
        { ContentID1: 'b', ContentID2: 'a' },
        { ContentID1: 'a', ContentID2: 'c' },
      ],
    })
    expect(removeMatching(db, 'a', 'b')).toBe(true)
    expect(readMatchingPairs(db)).toEqual([['a', 'c']])
    expect(db.prepare('SELECT count(*) AS n FROM djmdRecommendLike').get()).toEqual({ n: 1 })
  })

  it('reports nothing removed when the pair is not there', async () => {
    const db = await open()
    expect(removeMatching(db, 'a', 'b')).toBe(false)
  })
})
