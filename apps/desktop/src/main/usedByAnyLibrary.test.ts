import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
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

import {
  duplicateLibraryDeps,
  type LibraryHost,
  librariesKeepingOriginal,
  type Sessions,
  usedByAnyLibrary,
} from './libraryFlushes'
import { retireSuperseded } from './retireSuperseded'
import { concat, frame, track, utf16be } from './seratoDatabaseFixture'
import { seratoLibraryRoots } from './seratoLibrary'

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
const noReadOnly = () => ({ serato: [], virtualdj: [] })

describe('usedByAnyLibrary', () => {
  it('asks a library the DJ only reads from, since it still loses the track when the file goes', async () => {
    SETTINGS.traktorNmlPath = await nmlWith('A.mp3')
    STATUS.traktor.found = true
    expect(
      await usedByAnyLibrary(FILE, [], {
        traktorRead: () => SETTINGS.traktorNmlPath,
        readOnlyLibraries: noReadOnly,
      }),
    ).toBe(true)
  })

  it('asks an Engine DJ library that is found with its sync off', async () => {
    SETTINGS.engineLibraryDir = join(root, 'Engine Library')
    STATUS.engine.found = true
    await expect(
      usedByAnyLibrary(FILE, [], { traktorRead: noTraktor, readOnlyLibraries: noReadOnly }),
    ).rejects.toThrow()
  })

  it('asks the collection Traktor is found in when none is configured', async () => {
    const detected = await nmlWith('A.mp3')
    expect(
      await usedByAnyLibrary(FILE, [], {
        traktorRead: () => detected,
        readOnlyLibraries: noReadOnly,
      }),
    ).toBe(true)
  })

  it('reads as used when a library with its sync on has gone missing, since it may still hold the file', async () => {
    SETTINGS.syncTraktor = true
    SETTINGS.traktorNmlPath = join(root, 'gone.nml')
    await expect(
      usedByAnyLibrary(FILE, [], { traktorRead: noTraktor, readOnlyLibraries: noReadOnly }),
    ).rejects.toThrow()
    Object.assign(SETTINGS, settingsBefore)
    SETTINGS.syncEngineDj = true
    SETTINGS.engineLibraryDir = join(root, 'gone')
    await expect(
      usedByAnyLibrary(FILE, [], { traktorRead: noTraktor, readOnlyLibraries: noReadOnly }),
    ).rejects.toThrow()
  })

  it('asks Serato, which Surco only reads, so a file a crate still plays stays', async () => {
    const home = await mkdtemp(join(root, 'serato-'))
    await mkdir(join(home, 'Music', '_Serato_'), { recursive: true })
    await writeFile(
      join(home, 'Music', '_Serato_', 'database V2'),
      concat([
        frame('vrsn', utf16be('2.0/Serato Scratch LIVE Database')),
        track({ pfil: FILE.slice(1) }),
      ]),
    )
    const readOnlyLibraries = () => ({ serato: seratoLibraryRoots(home, []), virtualdj: [] })
    expect(await usedByAnyLibrary(FILE, [], { traktorRead: noTraktor, readOnlyLibraries })).toBe(
      true,
    )
    expect(
      await usedByAnyLibrary('/Volumes/Public/Music/T/B.mp3', [], {
        traktorRead: noTraktor,
        readOnlyLibraries,
      }),
    ).toBe(false)
  })

  it('keeps the file when the Serato database is cut short, since the part not read may list it', async () => {
    const home = await mkdtemp(join(root, 'serato-cut-'))
    await mkdir(join(home, 'Music', '_Serato_'), { recursive: true })
    const whole = concat([
      frame('vrsn', utf16be('2.0/Serato Scratch LIVE Database')),
      track({ pfil: 'Volumes/Public/Music/T/B.mp3' }),
      track({ pfil: FILE.slice(1) }),
    ])
    await writeFile(
      join(home, 'Music', '_Serato_', 'database V2'),
      whole.subarray(0, whole.length - 5),
    )
    const trash = vi.fn(async () => undefined)
    expect(
      await retireSuperseded(FILE, {
        usedByLibrary: (p) =>
          usedByAnyLibrary(p, [], {
            traktorRead: noTraktor,
            readOnlyLibraries: () => ({ serato: seratoLibraryRoots(home, []), virtualdj: [] }),
          }),
        exists: () => true,
        keepsTrash: () => true,
        policy: () => 'always',
        trash,
      }),
    ).toBe('used')
    expect(trash).not.toHaveBeenCalled()
  })

  it('says no when no library is found and none has its sync on', async () => {
    expect(
      await usedByAnyLibrary(FILE, [], { traktorRead: noTraktor, readOnlyLibraries: noReadOnly }),
    ).toBe(false)
  })

  it('keeps the file a second Apple Music entry still plays', async () => {
    const musicEntries = vi.fn(async () => ['P2'])
    expect(
      await usedByAnyLibrary(FILE, ['A', 'A.mp3'], {
        traktorRead: noTraktor,
        readOnlyLibraries: noReadOnly,
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
        readOnlyLibraries: noReadOnly,
        musicEntries,
        fileTitle: async () => 'A (Original Mix)',
        fileLike: async () => ({ durationSec: 241.5, size: 4096 }),
      }),
    ).toBe(true)
  })

  // Many DJ files carry no title tag. Without a name to start from, the stored length and
  // size are no guide either: a tag rewrite leaves Music's size stale, and a VBR MP3 without
  // a header or a FLAC without a sample count can be seconds off. Only every location is.
  it('checks every Music location for a file with no title, so an entry of another length and size still keeps it', async () => {
    const musicEntries = vi.fn(async () => [])
    const musicHolds = vi.fn(async (file: string) => file === FILE)
    for (const fileTitle of [
      async () => '  ',
      async () => {
        throw new Error('ffprobe failed')
      },
    ])
      expect(
        await usedByAnyLibrary(FILE, ['A'], {
          traktorRead: noTraktor,
          readOnlyLibraries: noReadOnly,
          musicEntries,
          musicHolds,
          fileTitle,
          fileLike: async () => ({ durationSec: 241.5, size: 4096 }),
        }),
      ).toBe(true)
    expect(musicEntries).not.toHaveBeenCalled()
  })

  it('retires a file with no title once no Music location points at it', async () => {
    expect(
      await usedByAnyLibrary(FILE, ['A'], {
        traktorRead: noTraktor,
        readOnlyLibraries: noReadOnly,
        musicEntries: async () => [],
        musicHolds: async () => false,
        fileTitle: async () => '',
      }),
    ).toBe(false)
  })

  it('keeps a file with no title when the locations cannot be read in time', async () => {
    await expect(
      usedByAnyLibrary(FILE, ['A'], {
        traktorRead: noTraktor,
        readOnlyLibraries: noReadOnly,
        musicEntries: async () => [],
        musicHolds: async () => {
          throw new Error('osascript timed out')
        },
        fileTitle: async () => '',
      }),
    ).rejects.toThrow()
    expect(
      await usedByAnyLibrary(FILE, ['A'], {
        traktorRead: noTraktor,
        readOnlyLibraries: noReadOnly,
        musicEntries: async () => [],
        fileTitle: async () => '',
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
        readOnlyLibraries: noReadOnly,
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
        readOnlyLibraries: noReadOnly,
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
        readOnlyLibraries: noReadOnly,
        musicEntries,
        fileTitle: async () => 'A',
        fileLike: async () => null,
      }),
    ).toBe(true)
    expect(
      await usedByAnyLibrary(FILE, ['A'], {
        traktorRead: noTraktor,
        readOnlyLibraries: noReadOnly,
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
        readOnlyLibraries: noReadOnly,
        musicEntries,
        fileTitle: async () => 'A',
        fileLike: async () => ({ durationSec: 241.5, size: 4096 }),
      }),
    ).toBe(false)
  })
})

describe('a file only Serato uses', () => {
  async function seratoHome(database: (dir: string) => Promise<void>) {
    const home = await mkdtemp(join(root, 'serato-only-'))
    await mkdir(join(home, 'Music', '_Serato_'), { recursive: true })
    await database(join(home, 'Music', '_Serato_', 'database V2'))
    return () => ({ serato: seratoLibraryRoots(home, []), virtualdj: [] })
  }
  const listing = (file: string) => (path: string) =>
    writeFile(
      path,
      concat([
        frame('vrsn', utf16be('2.0/Serato Scratch LIVE Database')),
        track({ pfil: file.slice(1) }),
      ]),
    )
  const unreadable = (path: string) => mkdir(path, { recursive: true }).then(() => undefined)
  const OTHER = '/Volumes/Public/Music/T/B.mp3'

  it('is kept from the trash, as the original of a rename and as a removed duplicate, since a crate still plays it', async () => {
    const readOnlyLibraries = await seratoHome(listing(FILE))
    const replace = duplicateLibraryDeps({} as LibraryHost, {} as Sessions, readOnlyLibraries)

    expect(await usedByAnyLibrary(FILE, [], { traktorRead: noTraktor, readOnlyLibraries })).toBe(
      true,
    )
    expect(
      await librariesKeepingOriginal(FILE, OTHER, { traktorRead: noTraktor, readOnlyLibraries }),
    ).toEqual(['serato'])
    expect(await replace.usedByLibrary(FILE)).toBe(true)

    expect(await usedByAnyLibrary(OTHER, [], { traktorRead: noTraktor, readOnlyLibraries })).toBe(
      false,
    )
    expect(
      await librariesKeepingOriginal(OTHER, FILE, { traktorRead: noTraktor, readOnlyLibraries }),
    ).toEqual([])
    expect(await replace.usedByLibrary(OTHER)).toBe(false)
  })

  it('is kept on every path when the Serato library cannot be read, since it may list the file', async () => {
    const readOnlyLibraries = await seratoHome(unreadable)
    const replace = duplicateLibraryDeps({} as LibraryHost, {} as Sessions, readOnlyLibraries)

    await expect(
      usedByAnyLibrary(FILE, [], { traktorRead: noTraktor, readOnlyLibraries }),
    ).rejects.toThrow()
    await expect(
      librariesKeepingOriginal(FILE, OTHER, { traktorRead: noTraktor, readOnlyLibraries }),
    ).rejects.toThrow()
    await expect(replace.usedByLibrary(FILE)).rejects.toThrow()
  })
})
