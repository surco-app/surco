import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// A real userData directory, unlike the other conversion suites: this one is about the
// analysis cache, which quietly disables itself when app.getPath is stubbed out. Mocked
// away, every assertion below would pass on a cache that never ran.
const userData = mkdtempSync(join(tmpdir(), 'surco-cachekey-userdata-'))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => userDataPath() },
}))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

function userDataPath(): string {
  return userData
}

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-cachekey-'))
const biased = join(dir, 'biased.wav')

const meta: TrackMetadata = {
  title: 'Biased',
  artist: 'Test',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

function peakDbOf(path: string): number {
  const { stderr } = spawnSync(
    FF,
    ['-hide_banner', '-nostats', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 16 },
  )
  const match = stderr.match(/max_volume:\s*(-?[\d.]+) dB/)
  if (!match) throw new Error(`no max_volume in ffmpeg output for ${path}`)
  return Number.parseFloat(match[1])
}

beforeAll(() => {
  // A tone pushed off-centre: its peak reads high because of the bias, so a peak
  // measured before centring sizes the gain against a number the centred signal
  // never has.
  execFileSync(FF, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=3',
    '-af',
    'volume=0.4,aeval=val(0)+0.2',
    '-c:a',
    'pcm_s16le',
    biased,
  ])
})

// The peak measurement runs through measurePrefilter, which carries the DC removal when
// it is on — so it is a fact about the file AND the centring, not the file alone. Its
// cache key said otherwise: one namespace for both, while the loudnorm key right beside
// it already carried a -dc marker. Converting once each way served the second run the
// first one's peak, sizing the gain against a maximum the audio no longer had.
describe('peak measurement cache key', () => {
  it('does not serve an uncentred peak to a centred conversion', async () => {
    const withoutDc = join(dir, 'peak-nodc.wav')
    const withDc = join(dir, 'peak-dc.wav')
    const cfg = { mode: 'peak', targetLufs: -14, peakDb: -3, truePeakDb: -1 } as const

    // Populates the cache under the shared namespace.
    await convertAudio(biased, withoutDc, 'wav', meta, undefined, cfg)
    await convertAudio(biased, withDc, 'wav', meta, undefined, { ...cfg, removeDcOffset: true })

    // Both runs asked for the same -3 dB ceiling, and each must actually reach it: the
    // centred one measured a smaller peak, so it needs more gain than the cached number
    // would have given it.
    expect(peakDbOf(withoutDc)).toBeCloseTo(-3, 1)
    expect(peakDbOf(withDc)).toBeCloseTo(-3, 1)
  })
})
