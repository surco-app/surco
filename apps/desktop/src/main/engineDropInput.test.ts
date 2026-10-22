import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { anlzFile, pqtzSection, pssiSection, pwv5Section } from './anlzFixture'
import { engineDropInput } from './engineDropInput'
import { analysedTrack } from './enginePerformanceFixture'
import { writeEngineLibraryFixture } from './enginePlaylistsFixture'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'

const ANLZ = '/PIONEER/USBANLZ/1/a/ANLZ0000.DAT'
const RB_BEATS = Array.from({ length: 200 }, (_, i) => 20 + i * 500)
const RB_WORDS = [
  { r: 7, g: 0, b: 0, h: 31 },
  { r: 0, g: 0, b: 7, h: 16 },
]
const SURCO_WORDS = new Uint16Array([1 << 2, 2 << 2])

async function engineLibrary(analysed = true): Promise<{ dir: string; file: string }> {
  const root = await mkdtemp(join(tmpdir(), 'surco-enginedrop-'))
  const dir = join(root, 'Engine Library')
  writeEngineLibraryFixture(dir, {
    tracks: [{ id: 4, path: '../Music/e.aiff', title: 'e', length: 60 }],
    playlists: [],
    entities: [],
    performance: analysed ? [analysedTrack(4)] : [],
  }).close()
  return { dir, file: resolve(dir, '../Music/e.aiff') }
}

async function collection(rows: { folderPath: string; analysed?: boolean }[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'surco-enginedrop-rb-'))
  const path = join(dir, 'master.db')
  const base = ORGANISE_FIXTURE.content[0]
  writeRekordboxPlaylistFixture(path, {
    ...ORGANISE_FIXTURE,
    content: rows.map((r, i) => ({
      ...base,
      ID: String(201 + i),
      FolderPath: r.folderPath,
      ...(r.analysed === false ? {} : { AnalysisDataPath: ANLZ }),
    })),
  })
  mkdirSync(join(dir, 'share', dirname(ANLZ)), { recursive: true })
  writeFileSync(join(dir, 'share', ANLZ), anlzFile(pqtzSection(RB_BEATS)))
  writeFileSync(
    join(dir, 'share', ANLZ.replace(/\.DAT$/, '.EXT')),
    anlzFile(
      pssiSection(1, [
        { beat: 1, kind: 1 },
        { beat: 33, kind: 2 },
      ]),
      pwv5Section(RB_WORDS),
    ),
  )
  return path
}

const word = (e: { r: number; g: number; b: number; h: number }) =>
  (e.r << 13) | (e.g << 10) | (e.b << 7) | (e.h << 2)

describe('engineDropInput', () => {
  it('detects on rekordbox’s own grid, phrases and wave when rekordbox has analysed the same file, the data Auto marcar was trained on', async () => {
    const { dir, file } = await engineLibrary()
    const words = vi.fn(async () => SURCO_WORDS)
    const input = await engineDropInput('engine:4', {
      libraryDir: dir,
      collection: await collection([{ folderPath: file }]),
      words,
    })
    expect(input?.grid.map((b) => b.ms)).toEqual(RB_BEATS)
    expect(input?.phrases.map((p) => p.ms)).toEqual([RB_BEATS[0], RB_BEATS[32]])
    expect([...(input?.words ?? [])]).toEqual(RB_WORDS.map(word))
    expect(words).not.toHaveBeenCalled()
  })

  it('finds the file in rekordbox by its resolved path, since each library may store it through a different link', async () => {
    const { dir, file } = await engineLibrary()
    const input = await engineDropInput('engine:4', {
      libraryDir: dir,
      collection: await collection([{ folderPath: '/Volumes/Public/Music/e.aiff' }]),
      realPath: (p) => (p === '/Volumes/Public/Music/e.aiff' ? file : p),
      words: async () => SURCO_WORDS,
    })
    expect(input?.grid.map((b) => b.ms)).toEqual(RB_BEATS)
  })

  it('reads Surco’s own words on Engine’s grid with no phrases when rekordbox does not have the file', async () => {
    const { dir, file } = await engineLibrary()
    const words = vi.fn(async () => SURCO_WORDS)
    const input = await engineDropInput('engine:4', {
      libraryDir: dir,
      collection: await collection([{ folderPath: '/elsewhere/e.aiff' }]),
      words,
    })
    expect(words).toHaveBeenCalledWith(file)
    expect(input?.grid[1]).toEqual({ ms: 500, beat: 2 })
    expect(input?.phrases).toEqual([])
    expect(input?.words).toBe(SURCO_WORDS)
  })

  it('reads Surco’s own words when rekordbox has the file but never analysed it', async () => {
    const { dir, file } = await engineLibrary()
    const input = await engineDropInput('engine:4', {
      libraryDir: dir,
      collection: await collection([{ folderPath: file, analysed: false }]),
      words: async () => SURCO_WORDS,
    })
    expect(input?.words).toBe(SURCO_WORDS)
  })

  it('does not guess between two rekordbox rows for one file and reads Surco’s words instead', async () => {
    const { dir, file } = await engineLibrary()
    const input = await engineDropInput('engine:4', {
      libraryDir: dir,
      collection: await collection([{ folderPath: file }, { folderPath: file }]),
      words: async () => SURCO_WORDS,
    })
    expect(input?.words).toBe(SURCO_WORDS)
  })

  it('reads Surco’s words when no rekordbox collection is set', async () => {
    const { dir } = await engineLibrary()
    const input = await engineDropInput('engine:4', {
      libraryDir: dir,
      collection: '',
      words: async () => SURCO_WORDS,
    })
    expect(input?.words).toBe(SURCO_WORDS)
  })

  it('has nothing to detect on before Engine has analysed the track, and decodes nothing for it', async () => {
    const { dir } = await engineLibrary(false)
    const words = vi.fn(async () => SURCO_WORDS)
    expect(await engineDropInput('engine:4', { libraryDir: dir, collection: '', words })).toBeNull()
    expect(words).not.toHaveBeenCalled()
  })

  it('has nothing to detect on when the audio cannot be read, rather than proposing on silence', async () => {
    const { dir } = await engineLibrary()
    expect(
      await engineDropInput('engine:4', {
        libraryDir: dir,
        collection: '',
        words: async () => null,
      }),
    ).toBeNull()
  })
})
