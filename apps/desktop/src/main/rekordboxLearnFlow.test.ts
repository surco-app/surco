import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { anlzFile, pqtzSection, pssiSection, pwavSection, pwv5Section } from './anlzFixture'
import { openRekordboxDb } from './rekordboxDb'
import { markedTracks, readCollectionMarks, readCollectionMarksAt } from './rekordboxLearnFlow'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'

const ANLZ = '/PIONEER/USBANLZ/219/e40e4/ANLZ0000.DAT'
const BEATS = Array.from({ length: 64 }, (_, i) => i * 500)

async function collectionAt(cueRows: { ID: string; InMsec: number; Kind: number }[]) {
  const dir = await mkdtemp(join(tmpdir(), 'surco-rblearn-'))
  const path = join(dir, 'master.db')
  writeRekordboxPlaylistFixture(path, {
    ...ORGANISE_FIXTURE,
    content: ORGANISE_FIXTURE.content.map((c) =>
      c.ID === '103' ? { ...c, AnalysisDataPath: ANLZ } : c,
    ),
    cueRows: cueRows.map((r) => ({
      ...r,
      ContentID: '103',
      ColorTableIndex: r.Kind === 0 ? null : 1,
    })),
  })
  const share = join(dir, 'share')
  mkdirSync(join(share, '/PIONEER/USBANLZ/219/e40e4'), { recursive: true })
  writeFileSync(join(share, ANLZ), anlzFile(pqtzSection(BEATS), pwavSection([31, 0, 16])))
  writeFileSync(
    join(share, ANLZ.replace('.DAT', '.EXT')),
    anlzFile(
      pssiSection(1, [
        { beat: 1, kind: 1 },
        { beat: 33, kind: 5 },
      ]),
      pwv5Section(Array.from({ length: 4800 }, () => ({ r: 7, g: 7, b: 7, h: 31 }))),
    ),
  )
  return { path, share }
}

async function collection(cueRows: { ID: string; InMsec: number; Kind: number }[]) {
  const { path, share } = await collectionAt(cueRows)
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error('did not open')
  return { db, share }
}

describe('readCollectionMarks', () => {
  it('reads each marked track once for both the flow and Auto, with the drop as the bar it marks', async () => {
    const { db, share } = await collection([
      { ID: 'h', InMsec: 8000, Kind: 1 },
      { ID: 'c', InMsec: 8000, Kind: 0 },
      { ID: 'd', InMsec: 16000, Kind: 0 },
    ])
    const marks = await readCollectionMarks(db, share, async () => {})
    expect(marks.learn).toHaveLength(1)
    expect(marks.taste).toEqual([expect.objectContaining({ key: '103', drops: [8] })])
    expect(marks.taste[0].candidates.length).toBeGreaterThan(0)
  })

  it('learns nothing for Auto from a track whose CALLs all sit under a hot cue, since it has no drop', async () => {
    const { db, share } = await collection([
      { ID: 'h', InMsec: 8000, Kind: 1 },
      { ID: 'c', InMsec: 8000, Kind: 0 },
    ])
    expect((await readCollectionMarks(db, share, async () => {})).taste).toEqual([])
  })

  it('pauses between tracks so the app keeps answering while a large collection is read', async () => {
    const { db, share } = await collection([{ ID: 'd', InMsec: 16000, Kind: 0 }])
    const pause = vi.fn(async () => {})
    await readCollectionMarks(db, share, pause)
    expect(pause).toHaveBeenCalled()
  })
})

describe('markedTracks', () => {
  it('counts the tracks with a CALL, the ones Surco can learn from, before the DJ asks it to', async () => {
    const { path } = await collectionAt([
      { ID: 'h', InMsec: 8000, Kind: 1 },
      { ID: 'd', InMsec: 16000, Kind: 0 },
      { ID: 'e', InMsec: 20000, Kind: 0 },
    ])
    expect(markedTracks(path)).toBe(1)
  })

  it('counts nothing without a collection', () => {
    expect(markedTracks('')).toBe(0)
  })
})

describe('readCollectionMarksAt', () => {
  it('opens the collection read-only and reads its marks, leaving the file as it was', async () => {
    const { path } = await collectionAt([{ ID: 'd', InMsec: 16000, Kind: 0 }])
    const before = readFileSync(path)
    const marks = await readCollectionMarksAt(path)
    expect(marks?.taste.map((t) => t.key)).toEqual(['103'])
    expect(readFileSync(path).equals(before)).toBe(true)
  })

  it('reads nothing without a collection', async () => {
    expect(await readCollectionMarksAt('')).toBeNull()
  })
})
