// @vitest-environment jsdom
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import ffmpegStatic from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { readTraktorCueStart, storedTree } from '../main/traktor4Fixture'
import { type AppScenario, openApp, openSection } from './app'
import { DROP_MS, makeTrack, scenarioDir } from './fixtures'

const RATE = 44100
const LEAD_IN_SEC = 2
const BEAT_MS = 500
const GRID_MS = 143.38
const DROP_SEC = DROP_MS / 1000

// A record with a silent lead-in, a quiet groove, and one loud hit exactly where the
// Traktor Drop cue sits, so where the hit lands in the converted file is where the cue
// must land too.
const WITH_DROP = `aevalsrc=if(lt(t\\,${LEAD_IN_SEC})\\,0\\,if(between(t\\,${DROP_SEC}\\,${DROP_SEC + 0.05})\\,0.9\\,0.1*sin(2*PI*220*t))):s=${RATE}:d=84`

function hitMs(path: string): number {
  const pcm = execFileSync(
    ffmpegStatic as unknown as string,
    ['-v', 'error', '-i', path, '-ac', '1', '-f', 's16le', '-'],
    { maxBuffer: 64 * 1024 * 1024 },
  )
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2)
  const at = samples.findIndex((s) => s > 0.5 * 32767)
  return (at / RATE) * 1000
}

// Cutting the dead air before a record is the trim a DJ does most, and its cost is
// invisible until the gig: every hotcue and the beatgrid were set against the old start,
// so unless they move with the audio, the Drop fires two seconds late and the grid sits
// between beats. Walked through the editor's own scissors, so the cut that reaches the
// conversion is the one the trim lane staged.
describe('Cut the silence before a record without moving its Traktor cue points', () => {
  let surco: AppScenario
  let folder: string
  let source: string
  let out: string

  beforeAll(async () => {
    folder = scenarioDir('trim-cues')
    source = join(folder, 'Record.flac')
    out = join(folder, 'Record.aiff')
    makeTrack(source, { title: 'Record', artist: 'A', bpm: 120, withCues: true, lavfi: WITH_DROP })
    surco = await openApp({ settings: {}, destination: 'beside' })
    await surco.drop(folder)
    await surco.select('Record')
    await openSection('editor-trim')
  }, 90_000)

  afterAll(() => {
    surco.close()
  })

  it('offers to cut the silent lead-in and stages it with one click', async () => {
    fireEvent.click(await screen.findByTestId('trim-apply-start', undefined, { timeout: 30_000 }))
    await screen.findByTestId('trim-cuts')
  }, 60_000)

  it('converts the record without its lead-in', async () => {
    fireEvent.click(screen.getByTestId('process-btn'))
    await waitFor(() => expect(existsSync(out)).toBe(true), { timeout: 60_000 })
    await waitFor(() => expect(screen.queryByTestId('done-more')).not.toBeNull(), {
      timeout: 60_000,
    })
    expect(surco.errors).toEqual([])
    expect(hitMs(source) - hitMs(out)).toBeGreaterThan(LEAD_IN_SEC * 1000 - 250)
  }, 90_000)

  it('keeps the Drop cue on the drop', () => {
    const tree = storedTree(out)
    expect(tree, 'the converted record lost its cues').not.toBeNull()
    expect(readTraktorCueStart(tree as Uint8Array, 1)).toBeCloseTo(hitMs(out), 0)
  })

  it('keeps the beatgrid on the beat', () => {
    const shift = hitMs(source) - hitMs(out)
    const anchor = readTraktorCueStart(storedTree(out) as Uint8Array, 0)
    const drift = (((anchor - (GRID_MS - shift)) % BEAT_MS) + BEAT_MS) % BEAT_MS
    expect(Math.min(drift, BEAT_MS - drift)).toBeLessThan(1)
  })
})
