// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { readTags } from '../main/ffmpeg'
import { listFiles, loudness, makeTrack } from './fixtures'
import { openSurco, type Scenario } from './harness'

function sha1(path: string): string {
  return createHash('sha1').update(readFileSync(path)).digest('hex')
}

describe('Get a USB stick ready for the club', () => {
  let home: string
  let usb: string
  let surco: Scenario
  const atHome = new Map<string, string>()

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'surco-home-'))
    usb = mkdtempSync(join(tmpdir(), 'surco-usb-'))
    makeTrack(join(home, 'Downloads', 'track01.flac'), {
      title: 'Gypsy Woman',
      artist: 'Crystal Waters',
      signal: 'kick',
    })
    makeTrack(join(home, 'Bought', 'b.mp3'), {
      title: 'Show Me Love',
      artist: 'Robin S',
      signal: 'kick',
    })
    for (const file of listFiles(home)) atHome.set(file, sha1(join(home, file)))

    surco = await openSurco({
      settings: {
        outputFormat: 'aiff',
        outputDir: usb,
        autoApplyFilename: true,
        normalize: { mode: 'loudness', targetLufs: -9, truePeakDb: -1, peakDb: -1 },
      },
      destination: 'folder',
    })
    await surco.drop(home)
    await surco.convertAll()
  }, 60_000)

  it('runs without a single error the user would see', () => {
    expect(surco.errors).toEqual([])
    expect(surco.sentToAppleMusic).toEqual([])
  })

  it('leaves every file at home exactly as it was', () => {
    expect(listFiles(home)).toEqual([...atHome.keys()])
    for (const [file, bytes] of atHome) expect(sha1(join(home, file)), file).toBe(bytes)
  })

  it('puts an AIFF of each track on the stick, named by the pattern', () => {
    expect(listFiles(usb)).toEqual([
      'Crystal Waters - Gypsy Woman.aiff',
      'Robin S - Show Me Love.aiff',
    ])
  })

  it('carries the tags onto the stick', async () => {
    expect(await readTags(join(usb, 'Robin S - Show Me Love.aiff'))).toMatchObject({
      title: 'Show Me Love',
      artist: 'Robin S',
    })
  })

  it('brings every copy to Club −9, within the 1.5 LU the limiter costs on real music, without peaks over the ceiling', () => {
    for (const file of listFiles(usb)) {
      const { integrated, truePeak } = loudness(join(usb, file))
      expect(Math.abs(integrated + 9), file).toBeLessThanOrEqual(1.5)
      expect(truePeak, file).toBeLessThanOrEqual(-1 + 0.1)
    }
  })
})
