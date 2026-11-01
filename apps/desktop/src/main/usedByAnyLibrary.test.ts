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
      await usedByAnyLibrary(FILE, ['A', 'A.mp3'], {
        traktorRead: noTraktor,
        musicEntries,
        fileTitle: async () => 'A',
        fileLike: async () => ({ durationSec: 241.5, size: 4096 }),
      }),
    ).toBe(true)
    expect(musicEntries).toHaveBeenCalledWith(FILE, ['A', 'A.mp3'], {
      durationSec: 241.5,
      size: 4096,
    })
  })

  it('finds the Music entry by the title the old file carries, since the DJ may have retitled the track in Surco since', async () => {
    const musicEntries = vi.fn(async (_path: string, titles: string[]) =>
      titles.includes('A (Original Mix)') ? ['P1'] : [],
    )
    expect(
      await usedByAnyLibrary(FILE, ['A (Extended Mix)'], {
        traktorRead: noTraktor,
        musicEntries,
        fileTitle: async () => 'A (Original Mix)',
        fileLike: async () => ({ durationSec: 241.5, size: 4096 }),
      }),
    ).toBe(true)
  })

  it('keeps the file when its title cannot be read, since Music may list it under a name nobody sent', async () => {
    const musicEntries = vi.fn(async () => [])
    expect(
      await usedByAnyLibrary(FILE, ['A'], {
        traktorRead: noTraktor,
        musicEntries,
        fileTitle: async () => {
          throw new Error('ffprobe failed')
        },
      }),
    ).toBe(true)
    expect(
      await usedByAnyLibrary(FILE, ['A'], {
        traktorRead: noTraktor,
        musicEntries,
        fileTitle: async () => '  ',
      }),
    ).toBe(true)
  })

  it('reads as used when Music cannot say which entries play the file', async () => {
    const musicEntries = vi.fn(async (): Promise<string[]> => {
      throw new Error('Music could not say which entries play the file')
    })
    await expect(
      usedByAnyLibrary(FILE, ['A'], {
        traktorRead: noTraktor,
        musicEntries,
        fileTitle: async () => 'A',
        fileLike: async () => ({ durationSec: 241.5, size: 4096 }),
      }),
    ).rejects.toThrow()
  })

  // A track renamed inside Music matches no title Surco knows; its length and size do.
  it('asks Music by the length and size of the file too, so an entry renamed there still keeps it', async () => {
    const musicEntries = vi.fn(
      async (_path: string, _titles: string[], like?: { durationSec: number; size: number }) =>
        like?.size === 4096 ? ['RENAMED'] : [],
    )
    expect(
      await usedByAnyLibrary(FILE, ['A'], {
        traktorRead: noTraktor,
        musicEntries,
        fileTitle: async () => 'A',
        fileLike: async () => ({ durationSec: 241.5, size: 4096 }),
      }),
    ).toBe(true)
  })

  it('keeps the file when its length cannot be read, since the names alone miss a renamed entry', async () => {
    const musicEntries = vi.fn(async () => [])
    expect(
      await usedByAnyLibrary(FILE, ['A'], {
        traktorRead: noTraktor,
        musicEntries,
        fileTitle: async () => 'A',
        fileLike: async () => null,
      }),
    ).toBe(true)
    expect(
      await usedByAnyLibrary(FILE, ['A'], {
        traktorRead: noTraktor,
        musicEntries,
        fileTitle: async () => 'A',
        fileLike: async () => {
          throw new Error('stat failed')
        },
      }),
    ).toBe(true)
  })

  it('retires a file no Music entry plays', async () => {
    const musicEntries = vi.fn(async () => [])
    expect(
      await usedByAnyLibrary(FILE, ['A'], {
        traktorRead: noTraktor,
        musicEntries,
        fileTitle: async () => 'A',
        fileLike: async () => ({ durationSec: 241.5, size: 4096 }),
      }),
    ).toBe(false)
  })
})
