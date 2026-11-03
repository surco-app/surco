import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type Database from 'better-sqlite3-multiple-ciphers'
import log from 'electron-log/main'
import { anlzSections } from './anlz'
import { encodePqtz, pqt2WithGrid, replaceSection } from './anlzWrite'
import { backupOf } from './libraryBackups'
import { insideShare } from './rekordboxArtwork'
import { rekordboxStamp, takeLocalUsn } from './rekordboxRows'
import { writeBackup } from './rekordboxSessionBackup'
import { replaceFile } from './replaceFile'

type Db = InstanceType<typeof Database>

export interface GridWrite {
  beats: { ms: number; beat: number }[]
  bpm: number
}

export interface AnlzPaths {
  dat: string
  ext: string
}

export function anlzPathsOf(db: Db, shareDir: string, contentId: string): AnlzPaths | null {
  const row = db
    .prepare(
      `SELECT AnalysisDataPath FROM djmdContent
        WHERE ID = ? AND coalesce(rb_local_deleted, 0) = 0`,
    )
    .get(contentId) as { AnalysisDataPath: string | null } | undefined
  if (!row?.AnalysisDataPath) return null
  const dat = resolve(shareDir, `.${row.AnalysisDataPath}`)
  if (!insideShare(shareDir, dat)) return null
  return { dat, ext: dat.replace(/\.DAT$/, '.EXT') }
}

async function replaceAtomically(path: string, bytes: Buffer): Promise<void> {
  const original = backupOf(path, 'session')
  if (!existsSync(original)) await writeBackup(path, original)
  await writeBackup(path, backupOf(path, 'backup'))
  await replaceFile(path, bytes)
}

export async function writeGridFiles(
  paths: AnlzPaths,
  grid: GridWrite,
  written: string[],
): Promise<void> {
  const dat = await readFile(paths.dat)
  await replaceAtomically(paths.dat, replaceSection(dat, 'PQTZ', encodePqtz(grid.beats, grid.bpm)))
  written.push(paths.dat)
  if (!existsSync(paths.ext)) return
  const ext = await readFile(paths.ext)
  const pqt2 = anlzSections(ext).find((s) => s.tag === 'PQT2')
  if (!pqt2) return
  const section = ext.subarray(pqt2.start, pqt2.start + pqt2.length)
  await replaceAtomically(
    paths.ext,
    replaceSection(ext, 'PQT2', pqt2WithGrid(section, grid.beats, grid.bpm)),
  )
  written.push(paths.ext)
}

export async function restoreGridFiles(written: string[]): Promise<boolean> {
  let restored = true
  for (const path of written) {
    try {
      await replaceFile(path, await readFile(backupOf(path, 'backup')))
    } catch (err) {
      log.error(`rekordbox ${path} could not be restored: ${String(err)}`)
      restored = false
    }
  }
  return restored
}

export function applyGridBpm(db: Db, contentId: string, bpm: number, ctx: { now: Date }): void {
  const stamp = rekordboxStamp(ctx.now)
  db.prepare('UPDATE djmdContent SET BPM = ?, rb_local_usn = ?, updated_at = ? WHERE ID = ?').run(
    Math.round(bpm * 100),
    takeLocalUsn(db, stamp),
    stamp,
    contentId,
  )
}
