import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrashEntry } from '../shared/types'
import { toNmlLocation } from './ffmpeg'
import { buildTraktorTree, id3WithPriv, injectAiffPriv, traktorCue } from './traktor4Fixture'
import { scanTraktorDamage } from './traktorCueDamageScan'

const FF = ffmpegStatic as unknown as string
const BOOT = 'Macintosh HD'
const root = mkdtempSync(join(tmpdir(), 'surco-traktor-damage-'))
let seq = 0

const tree = (shift: number) =>
  buildTraktorTree([
    traktorCue('Intro', 0, 10000 + shift, 0),
    traktorCue('Break', 0, 15000 + shift, 1),
  ])

function mp3With(path: string): void {
  const bare = `${path}.bare.mp3`
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=20:r=44100',
    '-ac',
    '2',
    '-c:a',
    'libmp3lame',
    '-write_id3v2',
    '0',
    bare,
  ])
  writeFileSync(path, Buffer.concat([id3WithPriv(tree(0)), readFileSync(bare)]))
}

function aiffWith(path: string, shift: number): void {
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=20:r=44100',
    '-ac',
    '2',
    path,
  ])
  injectAiffPriv(path, tree(shift))
}

const cueXml = (shift: number) =>
  `<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="31.5" LEN="0.000000" REPEATS="-1" HOTCUE="-1"></CUE_V2>` +
  `<CUE_V2 NAME="Intro" DISPL_ORDER="0" TYPE="0" START="${(10000 + shift).toFixed(6)}" LEN="0.000000" REPEATS="-1" HOTCUE="0"></CUE_V2>` +
  `<CUE_V2 NAME="Break" DISPL_ORDER="0" TYPE="0" START="${(15000 + shift).toFixed(6)}" LEN="0.000000" REPEATS="-1" HOTCUE="1"></CUE_V2>`

function entry(path: string, shift: number, file = toNmlLocation(path).file): string {
  const { dir } = toNmlLocation(path)
  return `<ENTRY TITLE="uno"><LOCATION DIR="${dir}" FILE="${file}" VOLUME="${BOOT}" VOLUMEID="x"></LOCATION><INFO GENRE="House"></INFO>${cueXml(shift)}</ENTRY>`
}

function nmlOf(entries: string[]): string {
  const path = join(root, `collection-${seq++}.nml`)
  writeFileSync(
    path,
    `<?xml version="1.0" encoding="UTF-8" standalone="no" ?><NML VERSION="19"><COLLECTION ENTRIES="${entries.length}">${entries.join('')}</COLLECTION></NML>`,
  )
  return path
}

function setup(name = 'uno') {
  const base = join(root, `case-${seq++}`)
  mkdirSync(join(base, 'mp3'), { recursive: true })
  mkdirSync(join(base, 'aiff'), { recursive: true })
  const mp3 = join(base, 'mp3', `${name}.mp3`)
  const aiff = join(base, 'aiff', `${name}.aiff`)
  mp3With(mp3)
  aiffWith(aiff, -51.18)
  return { base, mp3, aiff }
}

// Traktor kept the converted AIFF's calibrated cues on the MP3's own entry, so the MP3 plays
// every cue 51 ms early. The pair is found from whichever side the user loaded.
describe('scanTraktorDamage', () => {
  it("finds the MP3 entry that took its AIFF sibling's cues", async () => {
    const { mp3, aiff } = setup()
    const nml = nmlOf([entry(mp3, -51.18), entry(aiff, -51.18)])
    const found = await scanTraktorDamage([mp3], nml, {
      bootVolume: BOOT,
      backups: async () => [{ originalPath: mp3, outputPath: aiff } as TrashEntry],
    })
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      path: mp3,
      sibling: aiff,
      judgement: { kind: 'traktor-source-cues', certainty: 'sure', fixEntry: 'source' },
      entry: { volume: BOOT, file: 'uno.mp3' },
    })
    expect(found[0].judgement.addMs).toBeCloseTo(51.18, 1)
    expect(found[0].entry?.entryState).toEqual(expect.any(String))
    expect(found[0].before.map((c) => c.ms)).toEqual([9948.82, 14948.82])
  }, 30000)

  it('builds the same pair when only the AIFF is loaded', async () => {
    const { mp3, aiff } = setup()
    const nml = nmlOf([entry(mp3, -51.18), entry(aiff, -51.18)])
    const found = await scanTraktorDamage([aiff], nml, { bootVolume: BOOT })
    expect(found.map((d) => [d.path, d.judgement.kind])).toEqual([[mp3, 'traktor-source-cues']])
  }, 30000)

  it('reports a pair once when both sides are loaded', async () => {
    const { mp3, aiff } = setup()
    const nml = nmlOf([entry(mp3, -51.18), entry(aiff, -51.18)])
    expect(await scanTraktorDamage([mp3, aiff], nml, { bootVolume: BOOT })).toHaveLength(1)
  }, 30000)

  it('leaves the MP3 alone when two converted siblings could be the one', async () => {
    const { base, mp3, aiff } = setup()
    const flac = join(base, 'mp3', 'uno.flac')
    execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anoisesrc=d=1', flac])
    const nml = nmlOf([entry(mp3, -51.18), entry(aiff, -51.18)])
    expect(await scanTraktorDamage([mp3], nml, { bootVolume: BOOT })).toEqual([])
  }, 30000)

  it('finds a sibling Traktor stored with a decomposed name', async () => {
    const { mp3, aiff } = setup('canción')
    const nfd = toNmlLocation(aiff).file.normalize('NFD')
    const nml = nmlOf([entry(mp3, -51.18), entry(aiff, -51.18, nfd)])
    const found = await scanTraktorDamage([mp3], nml, { bootVolume: BOOT })
    expect(found.map((d) => d.judgement.kind)).toEqual(['traktor-source-cues'])
  }, 30000)

  it('rejects when the collection cannot be read', async () => {
    await expect(
      scanTraktorDamage(['/x/uno.mp3'], join(root, 'missing.nml'), { bootVolume: BOOT }),
    ).rejects.toThrow()
  })
})

describe('scanTraktorDamage provenance', () => {
  it('is only likely when Copias holds no record of the conversion', async () => {
    const { mp3, aiff } = setup()
    const nml = nmlOf([entry(mp3, -51.18), entry(aiff, -51.18)])
    const [found] = await scanTraktorDamage([mp3], nml, { bootVolume: BOOT })
    expect(found.judgement).toMatchObject({ certainty: 'likely', provenance: false })
  }, 30000)
})
