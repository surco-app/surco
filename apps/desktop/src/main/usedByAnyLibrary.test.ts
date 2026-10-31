import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))

const SETTINGS = vi.hoisted(() => ({
  syncRekordbox: false,
  rekordboxDbPath: '',
  syncEngineDj: false,
  engineLibraryDir: '',
  syncTraktor: false,
  traktorNmlPath: '',
}))
const STATUS = vi.hoisted(() => ({
  rekordbox: { enabled: false, found: false },
  engine: { enabled: false, found: false },
  traktor: { enabled: false, found: false },
}))
vi.mock('./settings', () => ({ getSettings: () => SETTINGS }))
vi.mock('./libraryStatus', () => ({ libraryStatus: () => STATUS }))
vi.mock('./rekordboxPath', () => ({ findRekordboxCollection: () => '' }))

import { usedByAnyLibrary } from './libraryFlushes'

const FILE = '/Volumes/Public/Music/T/A.mp3'
const settingsBefore = { ...SETTINGS }
const statusBefore = structuredClone(STATUS)
let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'surco-any-library-'))
})

afterEach(() => {
  Object.assign(SETTINGS, settingsBefore)
  Object.assign(STATUS, structuredClone(statusBefore))
})

async function nmlWith(file: string): Promise<string> {
  const path = join(root, `collection-${Math.random().toString(36).slice(2)}.nml`)
  await writeFile(
    path,
    `<NML><COLLECTION ENTRIES="1"><ENTRY TITLE="A"><LOCATION DIR="/:Music/:T/:" FILE="${file}" VOLUME="Public"></LOCATION></ENTRY></COLLECTION></NML>`,
  )
  return path
}

const noTraktor = () => ''

describe('usedByAnyLibrary', () => {
  it('asks a library the DJ only reads from, since it still loses the track when the file goes', async () => {
    SETTINGS.traktorNmlPath = await nmlWith('A.mp3')
    STATUS.traktor.found = true
    expect(await usedByAnyLibrary(FILE, [], { traktorRead: () => SETTINGS.traktorNmlPath })).toBe(
      true,
    )
  })

  it('asks an Engine DJ library that is found with its sync off', async () => {
    SETTINGS.engineLibraryDir = join(root, 'Engine Library')
    STATUS.engine.found = true
    await expect(usedByAnyLibrary(FILE, [], { traktorRead: noTraktor })).rejects.toThrow()
  })

  it('asks the collection Traktor is found in when none is configured', async () => {
    const detected = await nmlWith('A.mp3')
    expect(await usedByAnyLibrary(FILE, [], { traktorRead: () => detected })).toBe(true)
  })

  it('reads as used when a library with its sync on has gone missing, since it may still hold the file', async () => {
    SETTINGS.syncTraktor = true
    SETTINGS.traktorNmlPath = join(root, 'gone.nml')
    await expect(usedByAnyLibrary(FILE, [], { traktorRead: noTraktor })).rejects.toThrow()
    Object.assign(SETTINGS, settingsBefore)
    SETTINGS.syncEngineDj = true
    SETTINGS.engineLibraryDir = join(root, 'gone')
    await expect(usedByAnyLibrary(FILE, [], { traktorRead: noTraktor })).rejects.toThrow()
  })

  it('says no when no library is found and none has its sync on', async () => {
    expect(await usedByAnyLibrary(FILE, [], { traktorRead: noTraktor })).toBe(false)
  })

  it('keeps the file a second Apple Music entry still plays', async () => {
    const musicEntries = vi.fn(async () => ['P2'])
    expect(
      await usedByAnyLibrary(FILE, ['A', 'A.mp3'], { traktorRead: noTraktor, musicEntries }),
    ).toBe(true)
    expect(musicEntries).toHaveBeenCalledWith(FILE, ['A', 'A.mp3'])
  })

  it('reads as used when Music cannot say which entries play the file', async () => {
    const musicEntries = vi.fn(async (): Promise<string[]> => {
      throw new Error('Music could not say which entries play the file')
    })
    await expect(
      usedByAnyLibrary(FILE, ['A'], { traktorRead: noTraktor, musicEntries }),
    ).rejects.toThrow()
  })

  it('retires a file no Music entry plays', async () => {
    const musicEntries = vi.fn(async () => [])
    expect(await usedByAnyLibrary(FILE, ['A'], { traktorRead: noTraktor, musicEntries })).toBe(
      false,
    )
  })
})
