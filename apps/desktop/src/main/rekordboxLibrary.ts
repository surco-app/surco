import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import log from 'electron-log/main'
import type { WantedCue } from '../shared/cueRules'
import { backupOf } from './libraryBackups'
import {
  discardArtwork,
  rekordboxShareDir,
  renderArtwork,
  type StagedArtwork,
  stageArtwork,
} from './rekordboxArtwork'
import { type ContentProbe, type FileFacts, readFileFacts } from './rekordboxContentAdd'
import { liveCues, shiftCues } from './rekordboxCues'
import {
  FILE_TYPES,
  type FindOptions,
  isAmbiguous,
  openRekordboxDb,
  rekordboxPathKey,
  rekordboxStoredPath,
  sameFileOnDisk,
  type TrackFinder,
  trackFinder,
} from './rekordboxDb'
import { applyRekordboxMeta, type RekordboxMeta } from './rekordboxMetadata'
import { isRekordboxRunning } from './rekordboxProcess'
import { rekordboxStamp, takeLocalUsn } from './rekordboxRows'
import { foldWal, restoreCollection, writeBackup } from './rekordboxSessionBackup'

// Moves an existing collection entry onto the file a conversion just produced, so the
// track keeps its ID and therefore its playlists, cues and play history. Writing into a
// library the user cannot rebuild is what shapes everything here: the collection is
// backed up before it is touched, a running rekordbox refuses the write twice over, an
// ambiguous match refuses rather than guesses, and a failed write is rolled back.
//
// Best-effort, like the Traktor and Engine counterparts: the audio conversion has already
// succeeded on disk by the time this runs, so nothing here throws to its caller. Every
// failure path returns a reason instead.

// One backup, always the same name, overwritten on every write — the same bargain
// engineLibrary.ts and traktorNmlLibrary.ts strike. Dated copies would pile up on disk,
// one per converted track, for something they only want as a safety
// net. rekordbox keeps its own rotating backups beside it as well.

export type RepointResult =
  | {
      written: true
      id: string
      ids?: string[]
      // The cues each row of another master holds after this write, by row: what the
      // provisional list settles on the grid rekordbox draws once it has analysed the file.
      settleOnGrid?: Record<string, WantedCue[]>
    }
  | { written: false; reason: 'no-match' | 'output-missing' | 'unreadable' | 'occupied' }
  | { written: false; reason: 'rekordbox-running' | 'backup-failed' | 'write-failed' }
  | { written: false; reason: 'read-only' }
  | { written: false; reason: 'ambiguous'; ids: string[] }

export interface RepointOptions extends FindOptions, RepointBatchOptions {
  // The file the collection points at now, and the one it should point at instead.
  from: string
  to: string
  meta?: RekordboxMeta
  audio?: { cueShiftMs: number }
  snapToGrid?: true
  // Seam for the tests to force the failure that must never be simulated by damaging a
  // real collection: a write that dies halfway. Runs right after this track's row changed.
  onWrite?: () => void
}

// What a whole run shares. Seams for the tests too: a backup that cannot be made defaults
// to the real copy.
export interface RepointBatchOptions {
  backup?: (source: string, destination: string) => Promise<void>
  // Takes the run's single pre-run copy, before the first write. A failure here refuses
  // the write like any other missing backup.
  sessionBackup?: (collectionPath: string) => Promise<void>
  readCover?: (file: string) => Buffer | null
  // Reads the new file's bitrate, depth, rate and length; without it those columns keep
  // what they held.
  probe?: ContentProbe
}

// rekordbox stores the format as a number, so an entry left on the old code would
// describe the row as a file it no longer is.
function fileTypeFor(path: string): number | null {
  const ext = extname(path).slice(1).toLowerCase()
  return FILE_TYPES[ext] ?? null
}

export async function repointTrack(
  collectionPath: string,
  options: RepointOptions,
): Promise<RepointResult> {
  const { backup, sessionBackup, ...repoint } = options
  const [result] = await repointTracks(collectionPath, [repoint], { backup, sessionBackup })
  return result
}

type Repoint = Omit<RepointOptions, keyof RepointBatchOptions>

function stageCovers(
  db: NonNullable<ReturnType<typeof openRekordboxDb>>,
  collectionPath: string,
  repoints: Repoint[],
  writes: { index: number; id: string }[],
  readCover: RepointBatchOptions['readCover'],
): Map<string, StagedArtwork> {
  const staged = new Map<string, StagedArtwork>()
  const share = rekordboxShareDir(collectionPath)
  if (!readCover || !existsSync(share)) return staged
  const current = db.prepare('SELECT ImagePath FROM djmdContent WHERE ID = ?')
  // A row the run moves twice ends on its last file, so only that file's cover is staged.
  const last = new Set<string>()
  for (const w of [...writes].reverse()) {
    if (last.has(w.id)) continue
    last.add(w.id)
    const { to, meta } = repoints[w.index]
    if (!meta) continue
    try {
      const cover = readCover(to)
      const rendered = cover ? renderArtwork(cover) : null
      if (!rendered) continue
      const row = current.get(w.id) as { ImagePath: string | null } | undefined
      const artwork = stageArtwork(share, row?.ImagePath ?? null, rendered)
      if (artwork) staged.set(w.id, artwork)
    } catch (err) {
      log.warn(`rekordbox artwork skipped for ${to}: ${err}`)
    }
  }
  return staged
}

const twinPaths = (db: NonNullable<ReturnType<typeof openRekordboxDb>>, ids: string[]) => {
  const folder = db.prepare('SELECT FolderPath FROM djmdContent WHERE ID = ?')
  return ids.map((id) => (folder.get(id) as { FolderPath: string }).FolderPath)
}

const heldByAnother = (holder: ReturnType<TrackFinder>, ids: string[]): boolean =>
  holder !== null && (isAmbiguous(holder) || !ids.includes(holder.id))

// A whole run at once: one check that rekordbox is closed, one read to find every track,
// one backup, one more check, and one write for all of them. Each track used to pay all of
// that on its own, a full copy of the collection (the user's is 56 MB) and two opens
// through the cipher's key derivation, so a run of hundreds of tracks held the main
// process for minutes. Results come back per track, in the order given.
//
// One backup now stands behind the whole run, so the writes go in one transaction and a
// failure undoes all of them: no track is ever reported written from a collection that
// was rolled back.
export async function repointTracks(
  collectionPath: string,
  repoints: Repoint[],
  batch: RepointBatchOptions = {},
): Promise<RepointResult[]> {
  const copy = batch.backup ?? writeBackup
  const results: (RepointResult | undefined)[] = repoints.map(() => undefined)
  const pending: { index: number; size: number; fileType: number; file?: FileFacts | null }[] = []
  for (const [index, { from, to }] of repoints.entries()) {
    // The pair the renderer handed over, logged before any guard runs. A lookup miss can
    // come from the wrong `from` (the renderer named a file rekordbox never had) or from
    // the matching itself, and only seeing both ends tells them apart — three rounds of
    // guessing followed from having neither in the log.
    log.info(`rekordbox repoint attempt: from=${JSON.stringify(from)} to=${JSON.stringify(to)}`)
    // The converted file has to exist before the collection is told to point at it, or
    // the repoint just trades one missing-file "!" for another.
    let size: number
    try {
      size = (await stat(to)).size
    } catch {
      results[index] = { written: false, reason: 'output-missing' }
      continue
    }
    const fileType = fileTypeFor(to)
    if (fileType === null) {
      results[index] = { written: false, reason: 'output-missing' }
      continue
    }
    pending.push({ index, size, fileType })
  }
  // Every track still undecided gets the reason that stopped the run.
  const settle = (result: RepointResult): RepointResult[] => results.map((r) => r ?? result)
  if (pending.length === 0) return settle({ written: false, reason: 'output-missing' })
  const { probe } = batch
  if (probe)
    await Promise.all(
      pending.map(async (p) => {
        p.file = await readFileFacts(repoints[p.index].to, p.fileType, probe).catch(() => null)
      }),
    )

  // rekordbox holds master.db open through SQLCipher for as long as it runs, so a write
  // underneath it can be lost or can corrupt the file. Checked again below, right before
  // the write, because the app can be launched while this is reading.
  if (await isRekordboxRunning()) return settle({ written: false, reason: 'rekordbox-running' })

  const db = openRekordboxDb(collectionPath)
  if (!db) return settle({ written: false, reason: 'unreadable' })
  const writes: {
    index: number
    id: string
    size: number
    fileType: number
    file?: FileFacts | null
  }[] = []
  let folded = false
  try {
    const trackOf = trackFinder(db)
    // The rows each earlier repoint of the run puts on a file, by that file: the collection
    // read above does not know them yet.
    const planned = new Map<string, string[]>()
    for (const p of pending) {
      const repoint = repoints[p.index]
      const key = rekordboxPathKey(repoint)
      const chained = planned.get(key(repoint.from))
      if (chained) {
        if (planned.get(key(repoint.to))?.some((id) => !chained.includes(id)))
          results[p.index] = { written: false, reason: 'occupied' }
        else {
          for (const id of chained) writes.push({ ...p, id })
          planned.delete(key(repoint.from))
          planned.set(key(repoint.to), chained)
        }
        continue
      }
      const match = trackOf(repoint.from, repoint)
      // A collection that never had this track is the normal case for a partly-imported
      // library, and nothing — not even a backup — should be written for it.
      if (match === null) {
        results[p.index] = { written: false, reason: 'no-match' }
        continue
      }
      if (
        isAmbiguous(match) &&
        !sameFileOnDisk([repoint.from, ...twinPaths(db, match.ambiguous)])
      ) {
        results[p.index] = { written: false, reason: 'ambiguous', ids: match.ambiguous }
        continue
      }
      const ids = isAmbiguous(match) ? match.ambiguous : [match.id]
      if (
        heldByAnother(trackOf(repoint.to, repoint), ids) ||
        planned.get(key(repoint.to))?.some((id) => !ids.includes(id))
      )
        results[p.index] = { written: false, reason: 'occupied' }
      else {
        const unclaimed = ids.filter((id) => !writes.some((w) => w.id === id))
        if (unclaimed.length === 0) results[p.index] = { written: false, reason: 'occupied' }
        else {
          for (const id of unclaimed) writes.push({ ...p, id })
          planned.set(key(repoint.to), unclaimed)
        }
      }
    }
    if (writes.length > 0) {
      foldWal(db)
      folded = true
    }
  } catch {
    folded = false
  } finally {
    db.close()
  }
  if (writes.length === 0) return settle({ written: false, reason: 'no-match' })

  try {
    if (!folded) throw new Error('rekordbox collection WAL could not be folded into master.db')
    // The run's own copy first: it has to describe the collection as it was BEFORE the
    // run. Then the copy the rollback below restores.
    await batch.sessionBackup?.(collectionPath)
    await copy(collectionPath, backupOf(collectionPath, 'backup'))
  } catch (e) {
    log.warn(`rekordbox collection: backup of ${collectionPath} failed: ${(e as Error).message}`)
    // No backup, no write.
    return settle({ written: false, reason: 'backup-failed' })
  }

  // Second check, after the read and the backup: the vulnerable window is now just the
  // write itself. A user who double-clicks rekordbox while a conversion runs lands here.
  if (await isRekordboxRunning()) return settle({ written: false, reason: 'rekordbox-running' })

  const write = openRekordboxDb(collectionPath)
  if (!write) return settle({ written: false, reason: 'unreadable' })
  const staged = stageCovers(write, collectionPath, repoints, writes, batch.readCover)
  try {
    // FolderPath, FileNameL, FileType and FileSize are the four columns a format change
    // invalidates. OrgFolderPath is deliberately not among them: it records where the
    // track originally came from, and in the real collection 846 rows already disagree
    // with the live path while rekordbox runs fine. The row is stamped with rekordbox's
    // change counter like every other write, so its cloud sync sees the move.
    const update = write.prepare(
      `UPDATE djmdContent
          SET FolderPath = ?, FileNameL = ?, FileType = ?, FileSize = ?,
              rb_local_usn = ?, updated_at = ?
        WHERE ID = ?`,
    )
    // rekordbox reads these off the file when it imports it and never again, so a row moved
    // onto another file kept describing the old one: an AIFF listed at the MP3's 320 kbps.
    const technical = writes.some((w) => w.file)
      ? write.prepare(
          `UPDATE djmdContent SET BitRate = ?, BitDepth = ?, SampleRate = ?, Length = ? WHERE ID = ?`,
        )
      : null
    const now = new Date()
    const stamp = rekordboxStamp(now)
    const onGrid = new Map<number, Record<string, WantedCue[]>>()
    write.transaction(() => {
      for (const w of writes) {
        const { to, meta, audio, onWrite } = repoints[w.index]
        update.run(
          rekordboxStoredPath(to),
          basename(to),
          w.fileType,
          w.size,
          takeLocalUsn(write, stamp),
          stamp,
          w.id,
        )
        if (w.file)
          technical?.run(
            w.file.bitRateKbps,
            w.file.bitDepth,
            w.file.sampleRate,
            Math.floor(w.file.durationSec),
            w.id,
          )
        if (meta) applyRekordboxMeta(write, w.id, meta, { imagePath: staged.get(w.id)?.imagePath })
        if (audio) {
          shiftCues(write, w.id, audio.cueShiftMs, { now })
          // Measured in the user's rekordbox 24/10: after a repoint rekordbox never analyses
          // the new file by itself and keeps drawing the old one's waveform and grid over
          // it. An empty analysis is what a freshly imported track has, and rekordbox
          // analysed it on the next launch keeping every cue.
          write
            .prepare(
              `UPDATE djmdContent SET AnalysisDataPath = '', Analysed = 0, AnalysisUpdated = NULL
                WHERE ID = ?`,
            )
            .run(w.id)
        }
        // Placed after the statement so a test can fail the write once the row has
        // really changed — the only state in which the rollback below is doing anything.
        onWrite?.()
      }
      // Read once every write of the run is in, so a row moved twice hands back where its
      // cues ended. Loops go with them though they never move: the provisional list only
      // touches a row whose cues in rekordbox are still exactly this set, loops included.
      for (const w of writes) {
        if (!repoints[w.index].snapToGrid) continue
        const cues = liveCues(write, w.id)
        if (cues.every((c) => c.loop)) continue
        const byRow = onGrid.get(w.index) ?? {}
        byRow[w.id] = cues.map((c) => ({ id: c.id, ms: c.ms, kind: c.kind, color: c.color }))
        onGrid.set(w.index, byRow)
      }
    })()
    for (const w of writes) {
      const ids = writes.filter((o) => o.index === w.index).map((o) => o.id)
      const settleOnGrid = onGrid.get(w.index)
      results[w.index] ??= {
        written: true,
        id: w.id,
        ...(ids.length > 1 ? { ids } : {}),
        ...(settleOnGrid ? { settleOnGrid } : {}),
      }
    }
    return settle({ written: false, reason: 'no-match' })
  } catch (err) {
    for (const artwork of staged.values()) discardArtwork(artwork)
    // A collection the process cannot write to is the user's to fix — a permission, a
    // locked volume, a copy restored read-only — and a bare "write failed" does not say
    // that. Separated after hitting it for real: a read-only copy of the live collection
    // reported nothing more useful than a generic failure.
    if (String((err as { code?: unknown })?.code).startsWith('SQLITE_READONLY')) {
      for (const w of writes) results[w.index] = { written: false, reason: 'read-only' }
      return settle({ written: false, reason: 'read-only' })
    }
    // SQLite has already undone the transaction, which leaves the collection exactly as it
    // was found. The backup goes back only when even that rollback failed, and never over
    // a master.db a rekordbox launched meanwhile holds open: its busy lock is a common way
    // for this write to fail at all.
    let known = true
    try {
      if (write.inTransaction) write.exec('ROLLBACK')
    } catch (rollbackErr) {
      log.error(`rekordbox repoint rollback failed: ${String(rollbackErr)}`)
      known = false
    }
    write.close()
    if (!known && !(await isRekordboxRunning())) await restoreCollection(collectionPath)
    for (const w of writes) results[w.index] = { written: false, reason: 'write-failed' }
    return settle({ written: false, reason: 'write-failed' })
  } finally {
    write.close()
  }
}
