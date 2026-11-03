import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { gridBeats, gridFingerprint } from '../shared/gridEdit'
import { anlzSections, beatGrid } from './anlz'
import { anlzFile, pqt2Section, pqtzSection } from './anlzFixture'
import { backupOf } from './libraryBackups'
import { openRekordboxDb } from './rekordboxDb'
import {
  ORGANISE_FIXTURE,
  TWIN_PATHS,
  writeRekordboxPlaylistFixture,
} from './rekordboxPlaylistsFixture'
import type { CuesOp } from './rekordboxQueueOps'

vi.mock('./rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))

import { applyRekordboxBatch } from './rekordboxPlaylistWrite'

const ANLZ = '/PIONEER/USBANLZ/1/a/ANLZ0000.DAT'
const BEATS = Array.from({ length: 600 }, (_, i) => i * 500)
const READ_GRID = BEATS.map((ms, i) => ({ ms, beat: (i % 4) + 1 }))
const MOVED = { bpm: 120.5, anchorMs: 40 }

async function collection({ ext = true, analysed = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'surco-rbqgrid-'))
  const path = join(dir, 'master.db')
  writeRekordboxPlaylistFixture(path, {
    ...ORGANISE_FIXTURE,
    content: ORGANISE_FIXTURE.content.map((c) =>
      c.ID === '103' && analysed ? { ...c, AnalysisDataPath: ANLZ } : c,
    ),
  })
  mkdirSync(join(dir, 'share/PIONEER/USBANLZ/1/a'), { recursive: true })
  const dat = join(dir, 'share', ANLZ)
  writeFileSync(dat, anlzFile(pqtzSection(BEATS, 120)))
  if (ext) writeFileSync(dat.replace(/DAT$/, 'EXT'), anlzFile(pqt2Section(BEATS, 120)))
  return { path, dat, ext: dat.replace(/DAT$/, 'EXT') }
}

const deps = (over = {}) => ({
  ensureClosed: vi.fn(async () => true),
  sessionBackup: vi.fn(async () => {}),
  now: () => new Date('2026-11-03T19:00:00.000Z'),
  ...TWIN_PATHS,
  ...over,
})

const op = (over: Partial<CuesOp> = {}): CuesOp => ({
  id: 'g',
  kind: 'cues',
  contentId: '103',
  path: '/Volumes/Public/Music/Gowan.wav',
  label: 'Gowan',
  wanted: [],
  fingerprint: '',
  grid: MOVED,
  gridFingerprint: gridFingerprint(READ_GRID),
  ...over,
})

function bpmOf(path: string): number {
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error('did not open')
  try {
    return (db.prepare("SELECT BPM FROM djmdContent WHERE ID = '103'").get() as { BPM: number }).BPM
  } finally {
    db.close()
  }
}

const expectedBeats = () =>
  gridBeats(MOVED, 300000).map((b) => ({ ms: Math.round(b.ms), beat: b.beat, bpm: 120.5 }))

describe('saving an edited beat grid to rekordbox', () => {
  it('writes the grid into the analysis file and the BPM into the collection, even with no cue change', async () => {
    const { path, dat } = await collection()
    const result = await applyRekordboxBatch(path, [op()], deps())
    expect(result.ok && result.outcomes[0]).toEqual({ id: 'g', applied: true, notices: [] })
    expect(beatGrid(readFileSync(dat))).toEqual(expectedBeats())
    expect(bpmOf(path)).toBe(12050)
  })

  it('points the extended grid at the new first and last beats and keeps its per-beat body', async () => {
    const { path, ext } = await collection()
    const before = readFileSync(ext)
    await applyRekordboxBatch(path, [op()], deps())
    const after = readFileSync(ext)
    const s = anlzSections(after).find((x) => x.tag === 'PQT2')
    if (!s) throw new Error('no PQT2')
    const beats = expectedBeats()
    expect(after.readUInt32BE(s.start + 28)).toBe(beats[0].ms)
    expect(after.readUInt32BE(s.start + 36)).toBe(beats[beats.length - 1].ms)
    expect(after.readUInt16BE(s.start + 26)).toBe(12050)
    expect(after.subarray(s.start + 40).equals(before.subarray(s.start + 40))).toBe(true)
  })

  it('keeps a copy of each analysis file it rewrites', async () => {
    const { path, dat, ext } = await collection()
    const datBefore = readFileSync(dat)
    const extBefore = readFileSync(ext)
    await applyRekordboxBatch(path, [op()], deps())
    expect(readFileSync(backupOf(dat, 'backup')).equals(datBefore)).toBe(true)
    expect(readFileSync(backupOf(ext, 'backup')).equals(extBefore)).toBe(true)
  })

  it('refuses the grid when rekordbox moved it after Surco read it, and leaves the files alone', async () => {
    const { path, dat } = await collection()
    const before = readFileSync(dat)
    const result = await applyRekordboxBatch(path, [op({ gridFingerprint: 'stale' })], deps())
    expect(result.ok && result.outcomes[0]).toEqual({
      id: 'g',
      applied: false,
      notices: [{ code: 'cues-changed', track: 'Gowan' }],
    })
    expect(readFileSync(dat).equals(before)).toBe(true)
    expect(bpmOf(path)).not.toBe(12050)
  })

  it('still saves cues without a grid when rekordbox moved the grid, since they do not depend on it', async () => {
    const { path, dat } = await collection()
    writeFileSync(
      dat,
      anlzFile(
        pqtzSection(
          BEATS.map((ms) => ms + 3),
          120,
        ),
      ),
    )
    const result = await applyRekordboxBatch(
      path,
      [
        op({
          grid: undefined,
          gridFingerprint: undefined,
          wanted: [{ ms: 2000, kind: 0, color: null }],
        }),
      ],
      deps(),
    )
    expect(result.ok && result.outcomes[0]).toMatchObject({ applied: true })
  })

  it('refuses a grid for a track rekordbox has not analysed', async () => {
    const { path } = await collection({ analysed: false })
    const result = await applyRekordboxBatch(path, [op({ gridFingerprint: '' })], deps())
    expect(result.ok && result.outcomes[0]).toMatchObject({
      applied: false,
      notices: [{ code: 'cues-changed', track: 'Gowan' }],
    })
  })

  it('writes the grid when the track has no extended analysis file', async () => {
    const { path, dat, ext } = await collection({ ext: false })
    const result = await applyRekordboxBatch(path, [op()], deps())
    expect(result.ok && result.outcomes[0]).toMatchObject({ applied: true })
    expect(beatGrid(readFileSync(dat))).toEqual(expectedBeats())
    expect(existsSync(ext)).toBe(false)
  })

  it('puts the analysis files back when the collection write fails, so grid and BPM never disagree', async () => {
    const { path, dat, ext } = await collection()
    const datBefore = readFileSync(dat)
    const extBefore = readFileSync(ext)
    const result = await applyRekordboxBatch(
      path,
      [op()],
      deps({
        onWrite: () => {
          throw new Error('disk full')
        },
      }),
    )
    expect(result.ok).toBe(false)
    expect(readFileSync(dat).equals(datBefore)).toBe(true)
    expect(readFileSync(ext).equals(extBefore)).toBe(true)
  })

  it('puts the first analysis file back when the second cannot be written', async () => {
    const { path, dat, ext } = await collection()
    mkdirSync(`${ext}.surco-tmp`)
    const datBefore = readFileSync(dat)
    const result = await applyRekordboxBatch(path, [op()], deps())
    expect(result.ok).toBe(false)
    expect(readFileSync(dat).equals(datBefore)).toBe(true)
    expect(bpmOf(path)).not.toBe(12050)
  })
})
