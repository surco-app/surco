// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { suspectTracks, trackQuality } from '../renderer/src/lib/triage'
import { listFiles, lossyCopy, makeTrack } from './fixtures'
import { openSurco, type Scenario } from './harness'

function sha1(path: string): string {
  return createHash('sha1').update(readFileSync(path)).digest('hex')
}

describe('Check the quality of what you bought or downloaded', () => {
  let folder: string
  let surco: Scenario
  const bytes = new Map<string, string>()
  const verdict = (file: string) => {
    const row = surco.rows().find((r) => basename(r.inputPath) === file)
    return row ? trackQuality(row) : 'missing'
  }

  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'surco-quality-'))
    const studio = makeTrack(join(folder, 'Bought', 'Real Lossless.flac'), {
      title: 'Real Lossless',
      artist: 'A',
      signal: 'noise',
    })
    makeTrack(join(folder, 'Bought', 'Promo.mp3'), { title: 'Promo', artist: 'B', signal: 'noise' })
    lossyCopy(studio, join(folder, 'Downloaded', 'Fake Lossless.flac'))
    for (const file of listFiles(folder)) bytes.set(file, sha1(join(folder, file)))

    surco = await openSurco({ settings: { showSpectrum: true, autoAnalyze: true } })
    await surco.drop(folder)
    await surco.waitForAnalysis()
  }, 120_000)

  it('analyses every track without a single error', () => {
    expect(surco.errors).toEqual([])
  })

  it('flags a FLAC made from an MP3 as a lossy source, in red', () => {
    expect(verdict('Fake Lossless.flac')).toBe('transcoded')
  })

  it('never calls an MP3 bad quality for cutting the highs, since that is the format', () => {
    expect(verdict('Promo.mp3')).toBe('good')
  })

  it('passes a genuine lossless file', () => {
    expect(verdict('Real Lossless.flac')).toBe('good')
  })

  it('shows only the suspicious one under "Doubtful"', () => {
    expect(suspectTracks(surco.rows()).map((r) => basename(r.inputPath))).toEqual([
      'Fake Lossless.flac',
    ])
  })

  it('writes nothing to the files while analysing', () => {
    for (const [file, sha] of bytes) expect(sha1(join(folder, file)), file).toBe(sha)
  })
})
