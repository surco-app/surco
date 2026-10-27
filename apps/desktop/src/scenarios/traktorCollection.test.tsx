// @vitest-environment jsdom
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { toNmlLocation } from '../main/ffmpeg'
import { backupOf } from '../main/libraryBackups'
import { readTraktorCueStart, storedTree } from '../main/traktor4Fixture'
import { findEntries } from '../main/traktorNml'
import { bootVolumeName } from '../main/traktorNmlLibrary'
import { type AppScenario, openApp, openSection } from './app'
import { DROP_MS, makeTrack, scenarioDir } from './fixtures'

const COLLECTION_CUE_MS = 30_000
const WITH_LEAD_IN = 'aevalsrc=if(lt(t\\,2)\\,0\\,0.3*sin(2*PI*220*t)):s=44100:d=84'

function collection(source: string): string {
  const { volume: pathVolume, dir, file } = toNmlLocation(source)
  const volume = pathVolume || bootVolumeName()
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<NML VERSION="19"><HEAD COMPANY="www.native-instruments.com" PROGRAM="Traktor"></HEAD>
<COLLECTION ENTRIES="1">
<ENTRY MODIFIED_DATE="2026/10/14" TITLE="Record" ARTIST="A"><LOCATION DIR="${dir}" FILE="${file}" VOLUME="${volume}" VOLUMEID="${volume}"></LOCATION>
<TEMPO BPM="120.000000" BPM_QUALITY="100.000000"></TEMPO>
<CUE_V2 NAME="Breakdown" DISPL_ORDER="0" TYPE="0" START="${COLLECTION_CUE_MS.toFixed(6)}" LEN="0.000000" REPEATS="-1" HOTCUE="3"></CUE_V2>
</ENTRY>
</COLLECTION>
</NML>
`
}

function cueStart(entry: string, name: string): number {
  const cue = entry.match(new RegExp(`<CUE_V2 NAME="${name}"[^>]*START="([\\d.]+)"`))
  if (!cue) throw new Error(`scenario: the entry holds no cue named ${name}`)
  return Number(cue[1])
}

// Traktor finds a track by where it lives, in collection.nml, and keeps some hotcues only
// there. Replacing a FLAC with an AIFF without touching the collection leaves Traktor
// pointing at a file that is gone (the track turns missing, with its playlists and play
// count), and trimming its lead-in without moving those hotcues leaves them firing two
// seconds late. Both are wrong only in Traktor, long after the conversion looked fine.
describe('Replace a record kept in Traktor and find it still there, cues and all', () => {
  let surco: AppScenario
  let nml: string
  let out: string
  let entry: string

  beforeAll(async () => {
    const folder = scenarioDir('traktor-collection')
    const source = join(folder, 'Record.flac')
    out = join(folder, 'Record.aiff')
    nml = join(scenarioDir('traktor-library'), 'collection.nml')
    makeTrack(source, {
      title: 'Record',
      artist: 'A',
      bpm: 120,
      withCues: true,
      lavfi: WITH_LEAD_IN,
    })
    writeFileSync(nml, collection(source))
    surco = await openApp({
      settings: { syncTraktor: true, traktorNmlPath: nml },
      destination: 'overwrite',
    })
    await surco.drop(folder)
    await surco.select('Record')
    await openSection('editor-trim')
    fireEvent.click(await screen.findByTestId('trim-apply-start', undefined, { timeout: 30_000 }))
    await screen.findByTestId('trim-cuts')
    fireEvent.click(screen.getByTestId('process-btn'))
    fireEvent.click(await screen.findByTestId('confirm-ok'))
    await vi.waitFor(
      () => expect(findEntries(readFileSync(nml, 'utf8'))[0]?.file).toBe('Record.aiff'),
      { timeout: 60_000, interval: 200 },
    )
    entry = readFileSync(nml, 'utf8')
  }, 120_000)

  afterAll(() => {
    surco.close()
  })

  it('points the collection at the new file, so Traktor still finds the track', () => {
    expect(existsSync(out)).toBe(true)
    expect(findEntries(entry)).toHaveLength(1)
    expect(surco.errors).toEqual([])
  })

  it('moves the hotcues only Traktor kept as far as the ones in the file moved', () => {
    const shift = DROP_MS - readTraktorCueStart(storedTree(out) as Uint8Array, 1)
    expect(shift).toBeGreaterThan(1500)
    expect(cueStart(entry, 'Breakdown')).toBeCloseTo(COLLECTION_CUE_MS - shift, 0)
  })

  it('keeps a copy of the collection as it was before writing it', () => {
    expect(readFileSync(backupOf(nml, 'backup'), 'utf8')).toContain('FILE="Record.flac"')
  })
})
