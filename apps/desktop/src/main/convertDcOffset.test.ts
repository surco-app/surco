import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-dc-'))
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
  discogsReleaseId: '',
  rating: '',
  composer: '',
  isrc: '',
  mixName: '',
  originalYear: '',
  compilation: '',
  mood: '',
  energy: '',
}

// The mean sample value, per channel, as astats reports it. A centred signal reads ~0;
// this file is written 0.2 above centre on purpose.
function dcOffsetOf(path: string): number {
  // astats writes its report to stderr, so that is the stream to read — stdout is empty.
  const { stderr } = spawnSync(
    FF,
    [
      '-hide_banner',
      '-nostats',
      '-i',
      path,
      '-af',
      'aformat=sample_fmts=flt,astats',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8' },
  )
  const matches = [...stderr.matchAll(/DC offset:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]))
  if (matches.length === 0) throw new Error('astats reported no DC offset')
  return Math.max(...matches.map(Math.abs))
}

beforeAll(() => {
  // A 440 Hz tone sitting 0.2 above centre — a rip from a soundcard with a biased input,
  // which is where this correction earns its place: the bias eats headroom that the
  // normalizer would otherwise be able to use. Built from `sine` like the other
  // conversion fixtures rather than a synthetic aevalsrc, whose output carries no channel
  // layout and makes aresample refuse the chain for reasons unrelated to what is tested.
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

describe('DC offset removal through a real conversion', () => {
  it('starts from a genuinely biased file', () => {
    expect(dcOffsetOf(biased)).toBeGreaterThan(0.19)
  })

  // The regression this guards: DC removal lived only inside peak mode, so a user who
  // normalized by loudness silently kept the bias. It was extended to loudness mode, but
  // nothing measured the converted file to prove the filter reaches the encode chain —
  // and a user reported not seeing the correction land. Measuring the OUTPUT is the only
  // check that cannot pass on a filter that was built and then dropped.
  it('centres the signal when normalizing by loudness', async () => {
    const out = join(dir, 'loudness-dc.wav')
    await convertAudio(biased, out, 'wav', meta, undefined, {
      mode: 'loudness',
      targetLufs: -14,
      peakDb: -1,
      truePeakDb: -1,
      removeDcOffset: true,
    })
    expect(dcOffsetOf(out)).toBeLessThan(0.01)
  })

  // Leaving the box unticked must leave the signal alone: a correction the user did not
  // ask for is still a change to their audio.
  it('leaves the bias in place when removal is off', async () => {
    const out = join(dir, 'loudness-nodc.wav')
    await convertAudio(biased, out, 'wav', meta, undefined, {
      mode: 'loudness',
      targetLufs: -14,
      peakDb: -1,
      truePeakDb: -1,
    })
    expect(dcOffsetOf(out)).toBeGreaterThan(0.05)
  })
})
