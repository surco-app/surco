// @vitest-environment jsdom
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())
vi.mock('../main/rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))
vi.mock('../main/engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))
vi.mock('../main/traktorProcess', () => ({ isTraktorRunning: vi.fn(async () => false) }))

import { analysedTrack } from '../main/enginePerformanceFixture'
import { writeEngineLibraryFixture } from '../main/enginePlaylistsFixture'
import { toNmlLocation } from '../main/ffmpeg'
import { openRekordboxDb } from '../main/rekordboxDb'
import { isRekordboxRunning } from '../main/rekordboxProcess'
import { findEntries } from '../main/traktorNml'
import { bootVolumeName } from '../main/traktorNmlLibrary'
import { isTraktorRunning } from '../main/traktorProcess'
import { makeTrack, scenarioDir } from './fixtures'
import { openSurco, type Sabotage } from './harness'
import { makeRekordbox, rekordboxRow } from './rekordboxFixture'

afterEach(() => {
  vi.mocked(isRekordboxRunning).mockResolvedValue(false)
  vi.mocked(isTraktorRunning).mockResolvedValue(false)
})

function collection(source: string): string {
  const { volume: pathVolume, dir, file } = toNmlLocation(source)
  const volume = pathVolume || bootVolumeName()
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<NML VERSION="19"><HEAD COMPANY="www.native-instruments.com" PROGRAM="Traktor"></HEAD>
<COLLECTION ENTRIES="1">
<ENTRY MODIFIED_DATE="2026/10/14" TITLE="Plastic Dreams" ARTIST="Jaydee"><LOCATION DIR="${dir}" FILE="${file}" VOLUME="${volume}" VOLUMEID="${volume}"></LOCATION>
<TEMPO BPM="120.000000" BPM_QUALITY="100.000000"></TEMPO>
</ENTRY>
</COLLECTION>
</NML>
`
}

async function convertInTraktor(name: string) {
  const root = scenarioDir(name)
  const source = makeTrack(join(root, 'Crate', 'x.flac'), {
    title: 'Plastic Dreams',
    artist: 'Jaydee',
    signal: 'kick',
  })
  const nml = join(root, 'Traktor', 'collection.nml')
  mkdirSync(join(root, 'Traktor'), { recursive: true })
  writeFileSync(nml, collection(source))
  const surco = await openSurco({
    verify: true,
    settings: {
      outputFormat: 'aiff',
      syncTraktor: true,
      traktorNmlPath: nml,
    },
    destination: 'beside',
  })
  await surco.drop(join(root, 'Crate'))
  await surco.convertAll()
  await surco.settled()
  return { surco, nml }
}

async function convertInBothLibraries(
  name: string,
  sabotage?: (db: string, source: string) => Sabotage,
) {
  const root = scenarioDir(name)
  const source = makeTrack(join(root, 'Crate', 'x.flac'), {
    title: 'Plastic Dreams',
    artist: 'Jaydee',
    signal: 'kick',
  })
  const rekordboxDbPath = makeRekordbox(join(root, 'rekordbox'), [
    {
      id: '900001',
      path: source,
      title: 'Plastic Dreams',
      artist: 'Jaydee',
      fileType: 5,
      cuesMs: [2000],
    },
  ])
  const engineLibraryDir = join(root, 'Engine Library')
  writeEngineLibraryFixture(engineLibraryDir, {
    tracks: [{ id: 1, path: relative(engineLibraryDir, source), title: 'Plastic Dreams' }],
    playlists: [],
    entities: [],
    performance: [analysedTrack(1)],
  }).close()
  const surco = await openSurco({
    verify: true,
    sabotage: sabotage?.(rekordboxDbPath, source),
    settings: {
      outputFormat: 'aiff',
      outputDir: join(root, 'Surco'),
      syncRekordbox: true,
      rekordboxDbPath,
      syncEngineDj: true,
      engineLibraryDir,
    },
    destination: 'folder',
  })
  await surco.drop(join(root, 'Crate'))
  await surco.convertAll()
  await surco.settled()
  return surco
}

const rolledBack = (db: string, source: string): Sabotage => ({
  beforeLibraryCheck: () => {
    const opened = openRekordboxDb(db)
    opened
      ?.prepare(
        `UPDATE djmdContent SET FolderPath = ?, FileNameL = 'x.flac', FileType = 5 WHERE ID = '900001'`,
      )
      .run(source)
    opened?.close()
  },
})

describe('The self-check reads back what each library ended up pointing at', () => {
  it('says ok for a FLAC converted to AIFF once rekordbox and Engine point at it', async () => {
    const surco = await convertInBothLibraries('verify-ok')
    const v = surco.verification('x.flac')
    expect(v?.status).toBe('ok')
    expect(v?.checks.map((c) => [c.place, c.state])).toEqual([
      ['file', 'ok'],
      ['rekordbox', 'ok'],
      ['engine', 'ok'],
    ])
    expect(surco.statuses('x.flac')).toEqual(['ok'])
    expect(surco.errors).toEqual([])
  }, 60_000)

  it('says mismatch when rekordbox was put back on the old file before it was read', async () => {
    const surco = await convertInBothLibraries('verify-rollback', rolledBack)
    const v = surco.verification('x.flac')
    expect(v?.status).toBe('mismatch')
    expect(v?.checks.find((c) => c.place === 'rekordbox')?.detail.key).toBe('rekordboxStillOld')
  }, 60_000)

  it('says the file is wrong when its audio was damaged after the conversion wrote it', async () => {
    const surco = await convertInBothLibraries('verify-damaged', () => ({
      afterConvert: (finalPath) => {
        const bytes = readFileSync(finalPath)
        bytes.fill(0x55, Math.floor(bytes.length * 0.6), Math.floor(bytes.length * 0.6) + 4096)
        writeFileSync(finalPath, bytes)
      },
    }))
    const file = surco.verification('x.flac')?.checks.find((c) => c.place === 'file')
    expect(file?.state).toBe('mismatch')
    expect(file?.detail.key).toBe('filePcmDiffers')
  }, 60_000)

  it('refuses to wait for a verdict on a scenario opened without the self-check', async () => {
    const surco = await openSurco({ settings: { outputFormat: 'aiff' } })
    await expect(surco.settled()).rejects.toThrow('verify: true')
  })

  it('keeps a track pending, never ok, while rekordbox is open, and ok once it is closed', async () => {
    vi.mocked(isRekordboxRunning).mockResolvedValue(true)
    const surco = await convertInBothLibraries('verify-rekordbox-open')
    expect(surco.verification('x.flac')?.status).toBe('pending')
    expect(surco.verification('x.flac')?.checks.find((c) => c.place === 'rekordbox')?.state).toBe(
      'pending',
    )
    vi.mocked(isRekordboxRunning).mockResolvedValue(false)
    await surco.rekordboxClosed()
    await surco.settled()
    const seen = surco.statuses('x.flac')
    expect(seen.slice(0, -1)).not.toContain('ok')
    expect(seen.slice(0, -1)).toContain('pending')
    expect(seen.at(-1)).toBe('ok')
  }, 60_000)

  it('tells a retry made while rekordbox is open that it waits, never ok, until it closes', async () => {
    const surco = await convertInBothLibraries('verify-retry-open', rolledBack)
    expect(surco.statuses('x.flac')).toEqual(['mismatch'])
    vi.mocked(isRekordboxRunning).mockResolvedValue(true)
    expect(await surco.retry('x.flac')).toBe('rechecked')
    await surco.settled()
    expect(surco.statuses('x.flac')).toEqual(['mismatch', 'checking', 'pending'])
    vi.mocked(isRekordboxRunning).mockResolvedValue(false)
    await surco.rekordboxClosed()
    await surco.settled()
    expect(surco.statuses('x.flac')).toEqual(['mismatch', 'checking', 'pending', 'ok'])
  }, 60_000)

  it('points Traktor at the AIFF and says ok when Traktor was closed', async () => {
    const { surco, nml } = await convertInTraktor('verify-traktor-closed')
    expect(findEntries(readFileSync(nml, 'utf8'))[0]?.file).toBe('x.aiff')
    const traktor = surco.verification('x.flac')?.checks.find((c) => c.place === 'traktor')
    expect(traktor?.state).toBe('ok')
    expect(traktor?.detail.key).toBe('traktorOk')
    expect(surco.statuses('x.flac')).toEqual(['ok'])
  }, 60_000)

  it('waits for Traktor when it is open and applies on close', async () => {
    vi.mocked(isTraktorRunning).mockResolvedValue(true)
    const { surco, nml } = await convertInTraktor('verify-traktor-open')
    expect(findEntries(readFileSync(nml, 'utf8'))[0]?.file).toBe('x.flac')
    expect(surco.verification('x.flac')?.status).toBe('pending')
    expect(surco.errors).toContain('library sync blocked: traktorSyncBlocked')
    vi.mocked(isTraktorRunning).mockResolvedValue(false)
    await surco.traktorClosed()
    await surco.settled()
    expect(findEntries(readFileSync(nml, 'utf8'))[0]?.file).toBe('x.aiff')
    const seen = surco.statuses('x.flac')
    expect(seen.slice(0, -1)).not.toContain('ok')
    expect(seen.at(-1)).toBe('ok')
    expect(
      surco.verification('x.flac')?.checks.find((c) => c.place === 'traktor')?.detail.key,
    ).toBe('traktorOk')
  }, 60_000)

  it('rechecks on retry after the collection could not be read, without moving the cues again', async () => {
    let db = ''
    const away = () => `${db}.away`
    const surco = await convertInBothLibraries('verify-retry-unreadable', (path) => {
      db = path
      return { beforeLibraryCheck: () => renameSync(db, away()) }
    })
    const before = surco.verification('x.flac')
    expect(before?.status).toBe('mismatch')
    expect(before?.checks.find((c) => c.place === 'rekordbox')?.detail.key).toBe(
      'rekordboxUnreadable',
    )
    renameSync(away(), db)
    expect(await surco.retry('x.flac')).toBe('rechecked')
    await surco.settled()
    expect(surco.verification('x.flac')?.status).toBe('ok')
    expect(rekordboxRow(db, '900001').cuesMs).toEqual([2000])
  }, 60_000)
})
