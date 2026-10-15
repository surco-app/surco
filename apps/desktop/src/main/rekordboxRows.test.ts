import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openRekordboxDb } from './rekordboxDb'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'
import { rekordboxStamp, takeLocalUsn, unusedRowId } from './rekordboxRows'

async function open() {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-rbrows-')), 'master.db')
  writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
  const db = openRekordboxDb(path)
  if (!db) throw new Error('fixture did not open')
  return db
}

describe('rekordbox row helpers', () => {
  // rekordbox writes its timestamps as UTC with milliseconds and an explicit offset; a row in
  // another shape sorts wrongly against every row rekordbox wrote itself.
  it('stamps rows the way rekordbox does', () => {
    expect(rekordboxStamp(new Date('2026-10-15T18:00:00.000Z'))).toBe(
      '2026-10-15 18:00:00.000 +00:00',
    )
  })

  // Every change rekordbox makes takes the next number of one counter; a row written with a
  // number at or below it would read as older than changes already made.
  it('takes the next change number and moves the counter on', async () => {
    const db = await open()
    expect(takeLocalUsn(db, '2026-10-15 18:00:00.000 +00:00')).toBe(501)
    expect(takeLocalUsn(db, '2026-10-15 18:00:00.000 +00:00')).toBe(502)
    db.close()
  })

  it('never hands out an ID the table already uses', async () => {
    const db = await open()
    const ids = ['2000', '2000', '777']
    expect(unusedRowId(db, 'djmdPlaylist', () => ids.shift() ?? '0')).toBe('777')
    db.close()
  })
})
