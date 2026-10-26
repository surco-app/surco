import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { traktorContentId } from '../shared/traktorContent'
import { anlzFile, pqtzSection, pssiSection, pwv5Section } from './anlzFixture'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'
import { traktorDropInput } from './traktorDropInput'

const ANLZ = '/PIONEER/USBANLZ/1/a/ANLZ0000.DAT'
const RB_BEATS = Array.from({ length: 200 }, (_, i) => 20 + i * 500)
const SURCO_WORDS = new Uint16Array([1 << 2, 2 << 2])
const ID = traktorContentId('HD/:Music/:t.aiff')
const FILE = '/Music/t.aiff'

const nml = (analysed: boolean) =>
  `<NML VERSION="20"><COLLECTION ENTRIES="1"><ENTRY TITLE="t"><LOCATION DIR="/:Music/:" FILE="t.aiff" VOLUME="HD" VOLUMEID="v"></LOCATION><INFO PLAYTIME_FLOAT="60.0"></INFO>${
    analysed
      ? '<CUE_V2 NAME="AutoGrid" TYPE="4" START="0.000000" LEN="0" REPEATS="-1" HOTCUE="-1"><GRID BPM="120.000000"></GRID></CUE_V2>'
      : ''
  }</ENTRY></COLLECTION></NML>`

async function collection(folderPath: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'surco-traktordrop-rb-'))
  const path = join(dir, 'master.db')
  writeRekordboxPlaylistFixture(path, {
    ...ORGANISE_FIXTURE,
    content: [
      { ...ORGANISE_FIXTURE.content[0], ID: '201', FolderPath: folderPath, AnalysisDataPath: ANLZ },
    ],
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
      pwv5Section([{ r: 7, g: 0, b: 0, h: 31 }]),
    ),
  )
  return path
}

describe('traktorDropInput', () => {
  it('detects on rekordbox’s grid and phrases when rekordbox has analysed the same file', async () => {
    const words = vi.fn(async () => SURCO_WORDS)
    const input = await traktorDropInput(ID, {
      nml: nml(true),
      bootVolume: 'HD',
      collection: await collection(FILE),
      words,
    })
    expect(input?.grid.map((b) => b.ms)).toEqual(RB_BEATS)
    expect(words).not.toHaveBeenCalled()
  })

  it('reads Surco’s own words on Traktor’s grid, with no phrases, when rekordbox lacks the file', async () => {
    const words = vi.fn(async () => SURCO_WORDS)
    const input = await traktorDropInput(ID, {
      nml: nml(true),
      bootVolume: 'HD',
      collection: '',
      words,
    })
    expect(words).toHaveBeenCalledWith(FILE)
    expect(input?.grid[1]).toEqual({ ms: 500, beat: 2 })
    expect(input?.phrases).toEqual([])
    expect(input?.words).toBe(SURCO_WORDS)
  })

  it('has nothing to detect on before Traktor has analysed the track, and decodes nothing for it', async () => {
    const words = vi.fn(async () => SURCO_WORDS)
    expect(
      await traktorDropInput(ID, { nml: nml(false), bootVolume: 'HD', collection: '', words }),
    ).toBeNull()
    expect(words).not.toHaveBeenCalled()
  })
})
