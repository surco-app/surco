import { readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative, resolve } from 'node:path'
import log from 'electron-log/main'
import type { Database, SqlValue } from 'sql.js'
import type { TrackProperties } from '../shared/types'
import { loadSqlJs } from './engine'
import {
  decodeLoops,
  decodeOverview,
  decodeQuickCues,
  decodeTrackData,
  deflateEngineBlob,
  encodeLoops,
  encodeQuickCues,
  inflateEngineBlob,
  quickCueSlotBytes,
} from './engineBlobs'
import { assertEngineClosed, withEngineDatabase } from './engineLibrary'
import { backupOf } from './libraryBackups'
import { type PathMatchOptions, pathKey } from './libraryPathKey'
import { writeBackup } from './rekordboxSessionBackup'
import { renameWithRetry } from './renameRetry'

// Moves an existing Engine DJ library row onto the file a conversion just produced, so the
// track keeps its id and therefore its playlists, cues, loops and beatgrid. The Engine
// twin of rekordboxLibrary.ts's repointTracks: only the row's file columns change, the
// library is backed up first, a running Engine refuses the write, two rows for one file
// refuse rather than guess, and the swap is write-then-rename.
//
// Best-effort: the conversion has already succeeded on disk by the time this runs, so
// nothing here throws to its caller. Every failure path returns a reason instead.

// The same fixed backup name engineLibrary.ts writes before its own changes.

export type EngineRepointResult =
  | { written: true; id: string }
  | { written: false; reason: 'no-match' | 'output-missing' | 'unreadable' | 'occupied' }
  | { written: false; reason: 'engine-running' | 'backup-failed' | 'write-failed' }
  | { written: false; reason: 'ambiguous'; ids: string[] }

// How a conversion moved the audio under Engine's positions: the silence cut from the
// start, the converted file's sample rate when it was resampled, and its exact length in
// samples when the conversion measured it.
export interface EngineShift {
  trimmedMs: number
  sampleRateHz?: number
  sampleCount?: number
}

export interface EngineRepoint extends PathMatchOptions {
  // The file the library points at now, and the one it should point at instead.
  from: string
  to: string
  engineShift?: EngineShift
  // The source's size before a conversion rewrote it on its own path, what the row still
  // records until the new size, and the shift if any, land.
  fromBytes?: number
}

export interface EngineRepointOptions {
  // Takes the run's single pre-run copy, before the first write. A failure here refuses
  // the write like any other missing backup.
  sessionBackup?: (dbPath: string) => Promise<void>
  // The bitrate Engine would show for a file, when it can be told (engineBitrateKbps).
  bitrateOf?: (file: string) => Promise<number | undefined>
}

// Engine's bitrate for PCM, as its own rows store it: rate × depth × channels in rounded
// kbps (1411, 2117, 1536, 2304, 2822 in a real library). FLAC, ALAC and lossy files were
// never measured, so they have none.
export function engineBitrateKbps(
  p: Pick<TrackProperties, 'codec' | 'sampleRateHz' | 'bitDepth' | 'channels'>,
): number | undefined {
  if (!p.codec.startsWith('pcm_') || !p.bitDepth) return undefined
  return Math.round((p.sampleRateHz * p.bitDepth * p.channels) / 1000)
}

// Engine stores each path relative to the library folder, forward-slashed. Matching
// compares the absolute, resolved form; NFC first, because APFS treats NFC and NFD names as
// one file while a byte compare would not.
export function absolute(libraryDir: string, stored: string): string {
  return resolve(libraryDir, stored).normalize('NFC')
}

// The rows whose stored path resolves to a file. Resolving pays an lstat per path
// component, on a NAS hundreds of ms per hundred rows, and the library holds every track
// the DJ owns. The links a library is reached through are folders, so a file keeps its
// name through them: only rows of the same name, compared case-insensitively as pathKey
// does, are resolved at all, the narrowing rekordbox's candidateRows makes by FileNameL.
export function engineRowFinder<T extends { path: string }>(
  libraryDir: string,
  rows: T[],
): (file: string, key: (path: string) => string) => T[] {
  const byName = new Map<string, { row: T; at: string }[]>()
  for (const row of rows) {
    const at = absolute(libraryDir, row.path)
    const name = basename(at).toLowerCase()
    const same = byName.get(name)
    if (same) same.push({ row, at })
    else byName.set(name, [{ row, at }])
  }
  return (file, key) => {
    const nfc = file.normalize('NFC')
    const target = key(nfc)
    return (byName.get(basename(nfc).toLowerCase()) ?? [])
      .filter((c) => key(c.at) === target)
      .map((c) => c.row)
  }
}

type Blob = Uint8Array | null

interface Performance {
  trackData: Blob
  overviewWaveFormData: Blob
  beatData: Blob
  quickCues: Blob
  loops: Blob
}

function inflated(blob: Blob): Buffer | null {
  if (!blob || blob.length <= 4) return null
  try {
    return inflateEngineBlob(blob)
  } catch {
    return null
  }
}

// Every position Engine keeps for a track, moved onto the converted file: the cut comes off
// each one and each is rewritten at the new rate, and the overview drops the entries the cut
// took. A cue or loop inside the cut lands on the new start, as rekordbox's and Traktor's
// do, a loop keeping its length as Traktor's does; grid markers keep their spacing, so they
// may sit before it. Unset slots (-1) stay unset, and a blob that does not decode is left
// as Engine wrote it.
export function shiftEnginePerformance(perf: Performance, shift: EngineShift): Performance {
  const raw = inflated(perf.trackData)
  const track = raw && raw.length >= 16 ? raw : null
  const rawBeats = inflated(perf.beatData)
  const beats = rawBeats && rawBeats.length >= 17 ? rawBeats : null
  const from = track?.readDoubleBE(0) ?? beats?.readDoubleBE(0) ?? 0
  if (!(from > 0)) {
    if (perf.quickCues) log.warn('Engine DJ repoint: no sample rate to move the cues by')
    return perf
  }
  const to = shift.sampleRateHz ?? from
  const moved = (sample: number) => (sample / from - shift.trimmedMs / 1000) * to
  const set = (sample: number) => (sample < 0 ? sample : Math.max(0, moved(sample)))
  const was = track ? Number(track.readBigInt64BE(8)) : undefined
  const samples =
    shift.sampleCount ?? (was === undefined ? was : Math.max(0, Math.round(moved(was))))
  if (shift.trimmedMs === 0 && to === from && samples === was) return perf
  const next = { ...perf }

  if (track && samples !== undefined) {
    const length = Buffer.from(track)
    length.writeDoubleBE(to, 0)
    length.writeBigInt64BE(BigInt(samples), 8)
    next.trackData = deflateEngineBlob(length)
  }

  if (beats) {
    const grid = Buffer.from(beats)
    grid.writeDoubleBE(to, 0)
    grid.writeDoubleBE(shift.sampleCount ?? Math.max(0, moved(grid.readDoubleBE(8))), 8)
    let at = 17
    for (let g = 0; g < 2 && grid.length >= at + 8; g++) {
      const count = Number(grid.readBigInt64BE(at))
      if (count < 0 || grid.length < at + 8 + count * 24) break
      for (let i = 0; i < count; i++) {
        const m = at + 8 + i * 24
        grid.writeDoubleLE(moved(grid.readDoubleLE(m)), m)
      }
      at += 8 + count * 24
    }
    next.beatData = deflateEngineBlob(grid)
  }

  const overview = inflated(perf.overviewWaveFormData)
  const runSamples = overview && decodeOverview(overview) ? overview.readDoubleBE(16) : 0
  if (overview && runSamples > 0) {
    const count = Number(overview.readBigInt64BE(0))
    const dropped = Math.min(count, Math.round(((shift.trimmedMs / 1000) * from) / runSamples))
    const head = Buffer.from(overview.subarray(0, 24))
    head.writeBigInt64BE(BigInt(count - dropped), 0)
    if (Number(head.readBigInt64BE(8)) === count) head.writeBigInt64BE(BigInt(count - dropped), 8)
    head.writeDoubleBE((runSamples * to) / from, 16)
    next.overviewWaveFormData = deflateEngineBlob(
      Buffer.concat([head, overview.subarray(24 + dropped * 3)]),
    )
  }

  const rawCues = inflated(perf.quickCues)
  const cues = rawCues && decodeQuickCues(rawCues)
  if (cues) {
    const tail = Buffer.from(cues.tail)
    if (tail.length >= 17) {
      tail.writeDoubleBE(set(tail.readDoubleBE(0)), 0)
      tail.writeDoubleBE(set(tail.readDoubleBE(9)), 9)
    }
    next.quickCues = deflateEngineBlob(
      encodeQuickCues(
        cues.slots.map((slot) =>
          slot.cue ? quickCueSlotBytes({ ...slot.cue, sample: set(slot.cue.sample) }) : slot.bytes,
        ),
        tail,
      ),
    )
  }

  const loops = perf.loops && decodeLoops(Buffer.from(perf.loops))
  if (loops)
    next.loops = encodeLoops(
      loops.loops.map((loop) => {
        const start = loop.startSet ? set(loop.start) : loop.start
        const end =
          loop.startSet && loop.endSet
            ? start + ((loop.end - loop.start) * to) / from
            : loop.endSet
              ? set(loop.end)
              : loop.end
        return { ...loop, start, end }
      }),
      loops.tail,
    )
  return next
}

function performanceOf(db: Database, id: number): Performance | null {
  const statement = db.prepare(
    'SELECT trackData, overviewWaveFormData, beatData, quickCues, loops FROM PerformanceData WHERE trackId = ?',
  )
  try {
    statement.bind([id])
    return statement.step() ? (statement.getAsObject() as unknown as Performance) : null
  } finally {
    statement.free()
  }
}

function relativeTo(libraryDir: string, file: string): string {
  return relative(libraryDir, file).split('\\').join('/')
}

export function repointEngineTracks(
  libraryDir: string,
  repoints: EngineRepoint[],
  options: EngineRepointOptions = {},
): Promise<EngineRepointResult[]> {
  return withEngineDatabase(join(libraryDir, 'Database2', 'm.db'), () =>
    writeEngineRepoints(libraryDir, repoints, options),
  )
}

export async function writeEngineRepoints(
  libraryDir: string,
  repoints: EngineRepoint[],
  options: EngineRepointOptions = {},
): Promise<EngineRepointResult[]> {
  const dbPath = join(libraryDir, 'Database2', 'm.db')
  const results: (EngineRepointResult | null)[] = repoints.map(() => null)

  const sizes = await Promise.all(
    repoints.map(async (r) => {
      try {
        return (await stat(r.to)).size
      } catch {
        return null
      }
    }),
  )
  sizes.forEach((size, i) => {
    if (size === null) results[i] = { written: false, reason: 'output-missing' }
  })

  const fill = (result: EngineRepointResult) => results.map((r) => r ?? result)
  if (results.every((r) => r !== null)) return results as EngineRepointResult[]

  try {
    await assertEngineClosed(dbPath)
  } catch {
    return fill({ written: false, reason: 'engine-running' })
  }

  let db: Database
  try {
    const SQL = await loadSqlJs()
    db = new SQL.Database(await readFile(dbPath))
    db.exec('SELECT id FROM Track LIMIT 1')
  } catch (e) {
    log.warn(`Engine DJ repoint: cannot read ${dbPath}: ${(e as Error).message}`)
    return fill({ written: false, reason: 'unreadable' })
  }

  try {
    const stored = (
      db.exec('SELECT id, path, fileBytes FROM Track ORDER BY id')[0]?.values ?? []
    ).map(([id, path, fileBytes]) => ({
      id: String(id),
      path: String(path),
      fileBytes,
    }))
    const find = engineRowFinder(libraryDir, stored)
    const updates: {
      id: string
      to: string
      size: number
      shift?: EngineShift
      inPlace: boolean
    }[] = []
    for (const [i, repoint] of repoints.entries()) {
      if (results[i]) continue
      const key = pathKey(repoint)
      const matches = find(repoint.from, key)
      if (matches.length === 0) {
        results[i] = { written: false, reason: 'no-match' }
        continue
      }
      if (matches.length > 1) {
        results[i] = { written: false, reason: 'ambiguous', ids: matches.map((m) => m.id) }
        continue
      }
      const onTarget = find(repoint.to, key)
      if (onTarget.some((row) => row.id !== matches[0].id)) {
        results[i] = { written: false, reason: 'occupied' }
        continue
      }
      // A row already on the file takes only its new size and shift, and only while it still
      // records the source's size: the same write records the new one, so the shift lands once.
      if (
        onTarget.length > 0 &&
        (repoint.fromBytes === undefined || matches[0].fileBytes !== repoint.fromBytes)
      ) {
        results[i] = { written: false, reason: 'no-match' }
        continue
      }
      updates.push({
        id: matches[0].id,
        to: repoint.to,
        size: sizes[i] as number,
        shift: repoint.engineShift,
        inPlace: onTarget.length > 0,
      })
      results[i] = { written: true, id: matches[0].id }
    }
    if (updates.length === 0) return results as EngineRepointResult[]

    try {
      await options.sessionBackup?.(dbPath)
      await writeBackup(dbPath, backupOf(dbPath, 'backup'))
    } catch (e) {
      log.warn(`Engine DJ repoint: backup failed: ${(e as Error).message}`)
      return results.map((r) =>
        r?.written ? { written: false, reason: 'backup-failed' } : r,
      ) as EngineRepointResult[]
    }

    for (const u of updates) {
      const perf = u.shift ? performanceOf(db, Number(u.id)) : null
      const next = perf && u.shift && shiftEnginePerformance(perf, u.shift)
      const track =
        next && next.trackData !== perf.trackData && next.trackData
          ? decodeTrackData(inflateEngineBlob(next.trackData))
          : null
      // Only the file columns, and the length the track list shows when the samples changed,
      // in whole seconds as Engine rounds it. A row moved to another file has its bitrate
      // cleared, as Surco's own inserts leave it: the old file's value would describe the new
      // one wrongly, and Engine fills it in when it next analyzes the track. A row rewritten
      // in place keeps its file, so it keeps its bitrate unless the file says what it is now.
      const bitrate = u.inPlace ? await options.bitrateOf?.(u.to).catch(() => undefined) : null
      const set: [string, SqlValue][] = [
        ['path', relativeTo(libraryDir, u.to)],
        ['filename', basename(u.to)],
        ['fileType', extname(u.to).slice(1).toLowerCase()],
        ['fileBytes', u.size],
        ...(bitrate === undefined ? [] : [['bitrate', bitrate] as [string, SqlValue]]),
        ...(track
          ? [['length', Math.round(track.sampleCount / track.sampleRate)] as [string, SqlValue]]
          : []),
      ]
      db.run(`UPDATE Track SET ${set.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`, [
        ...set.map(([, value]) => value),
        Number(u.id),
      ])
      if (next && next !== perf)
        db.run(
          'UPDATE PerformanceData SET trackData = ?, overviewWaveFormData = ?, beatData = ?, quickCues = ?, loops = ? WHERE trackId = ?',
          [
            next.trackData,
            next.overviewWaveFormData,
            next.beatData,
            next.quickCues,
            next.loops,
            Number(u.id),
          ],
        )
    }

    // Engine launched while the rows were being read would have loaded the old library and
    // write it back over this one on quit, so the check repeats right before the swap.
    try {
      await assertEngineClosed(dbPath)
    } catch {
      return results.map((r) =>
        r?.written ? { written: false, reason: 'engine-running' } : r,
      ) as EngineRepointResult[]
    }
    const tmp = `${dbPath}.surco-tmp`
    try {
      await writeFile(tmp, db.export())
      await renameWithRetry(tmp, dbPath)
    } catch (e) {
      log.warn(`Engine DJ repoint: write failed: ${(e as Error).message}`)
      await unlink(tmp).catch(() => {})
      return results.map((r) =>
        r?.written ? { written: false, reason: 'write-failed' } : r,
      ) as EngineRepointResult[]
    }
    return results as EngineRepointResult[]
  } finally {
    db.close()
  }
}
