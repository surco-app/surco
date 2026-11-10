// @vitest-environment jsdom
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())
vi.mock('../main/traktorProcess', () => ({ isTraktorRunning: vi.fn(async () => true) }))

import { toNmlLocation } from '../main/ffmpeg'
import { findEntries } from '../main/traktorNml'
import { bootVolumeName } from '../main/traktorNmlLibrary'
import { isTraktorRunning } from '../main/traktorProcess'
import { makeTrack, scenarioDir } from './fixtures'
import { openSurco, type Scenario } from './harness'

function collection(source: string): string {
  const { volume: pathVolume, dir, file } = toNmlLocation(source)
  const volume = pathVolume || bootVolumeName()
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<NML VERSION="19"><HEAD COMPANY="www.native-instruments.com" PROGRAM="Traktor"></HEAD>
<COLLECTION ENTRIES="1">
<ENTRY MODIFIED_DATE="2026/10/14" TITLE="Record" ARTIST="A"><LOCATION DIR="${dir}" FILE="${file}" VOLUME="${volume}" VOLUMEID="${volume}"></LOCATION>
<TEMPO BPM="120.000000" BPM_QUALITY="100.000000"></TEMPO>
</ENTRY>
</COLLECTION>
</NML>
`
}

describe('Replace a record kept in Traktor while Traktor is open', () => {
  let nml: string
  let before: string
  let surco: Scenario

  beforeAll(async () => {
    const folder = scenarioDir('traktor-open')
    const source = join(folder, 'Record.flac')
    nml = join(scenarioDir('traktor-open-library'), 'collection.nml')
    makeTrack(source, { title: 'Record', artist: 'A', bpm: 120 })
    before = collection(source)
    writeFileSync(nml, before)
    surco = await openSurco({
      settings: { syncTraktor: true, traktorNmlPath: nml },
      destination: 'overwrite',
    })
    await surco.drop(folder)
    await surco.convertAll()
  }, 60_000)

  it('finishes the conversion without asking to close Traktor or failing the track', () => {
    expect(surco.errors).toEqual([])
    expect(surco.summary()?.failed ?? 0).toBe(0)
  })

  it('leaves collection.nml untouched while Traktor is open, since Traktor rewrites it when it quits', () => {
    expect(readFileSync(nml, 'utf8')).toBe(before)
  })

  it('keeps the move to the new file in the Traktor queue, so the DJ sees it is still to land', () => {
    expect(surco.traktorQueue().tracks).toBe(1)
  })

  it('points the entry at the AIFF once Traktor closes', async () => {
    vi.mocked(isTraktorRunning).mockResolvedValue(false)
    await surco.traktorClosed()
    expect(surco.traktorQueue().tracks).toBe(0)
    expect(findEntries(readFileSync(nml, 'utf8')).map((e) => e.file)).toEqual(['Record.aiff'])
  })
})
