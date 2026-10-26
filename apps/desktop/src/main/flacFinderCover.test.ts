import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
let syncTraktor = false
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '', syncTraktor }) }))

import ffmpegStatic from 'ffmpeg-static'
import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { setFinderIcon } from './flacFinderCover'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-findercover-'))
const flac = join(dir, 'in.flac')
const cover = join(dir, 'cover.jpg')

const meta: TrackMetadata = {
  title: 'Elastic Pump',
  artist: 'Javi Soria',
  album: 'Elastic Pump',
  albumArtist: 'Javi Soria',
  year: '2024',
  genre: 'Electronic',
  grouping: '',
  comment: '',
  trackNumber: '1',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

const ICON_CENTER = `ObjC.import('AppKit')
function run(argv) {
  const icon = $.NSWorkspace.sharedWorkspace.iconForFile(argv[0])
  const rep = $.NSBitmapImageRep.imageRepWithData(icon.TIFFRepresentation)
  const c = rep.colorAtXY(rep.pixelsWide / 2, rep.pixelsHigh / 2)
  return [c.redComponent, c.greenComponent, c.blueComponent].map((v) => Math.round(v * 255)).join(',')
}`

const showsCoverInFinder = (file: string): boolean => {
  const [r, g, b] = execFileSync('osascript', ['-l', 'JavaScript', '-e', ICON_CENTER, file])
    .toString()
    .trim()
    .split(',')
    .map(Number)
  return r > 200 && g < 50 && b < 50
}

const convertWithFinderCovers = (input: string, out: string, coverPath?: string) =>
  convertAudio(
    input,
    out,
    'flac',
    meta,
    coverPath,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
  )

beforeAll(() => {
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=300x300:d=1',
    '-frames:v',
    '1',
    cover,
  ])
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-c:a',
    'flac',
    flac,
  ])
})

// Finder never reads FLAC's own PICTURE block. Surco used to prepend an ID3 tag carrying
// the cover, which Finder does read, but a FLAC that no longer starts with "fLaC" is one
// Traktor rejects and drops from its collection. A custom Finder icon lives in the file's
// extended attributes, so the cover shows without a single byte of the audio file changing.
describe.runIf(process.platform === 'darwin')('setFinderIcon', () => {
  it('shows the cover in Finder and leaves the FLAC byte for byte as it was', async () => {
    const p = join(dir, 'direct.flac')
    copyFileSync(flac, p)
    await setFinderIcon(p, cover)
    expect(readFileSync(p).equals(readFileSync(flac))).toBe(true)
    expect(showsCoverInFinder(p)).toBe(true)
  })
})

describe.runIf(process.platform === 'darwin')('convertAudio with Finder covers enabled', () => {
  it('shows the cover in Finder on a FLAC that still starts with fLaC', async () => {
    const out = join(dir, 'out-finder.flac')
    await convertWithFinderCovers(flac, out, cover)
    expect(readFileSync(out).toString('latin1', 0, 4)).toBe('fLaC')
    expect(showsCoverInFinder(out)).toBe(true)
  })

  // The ID3 prefix had to be switched off for anyone syncing to Traktor, which is most
  // of the DJs who asked for this option. The icon never touches the file, so there is
  // nothing for Traktor to reject and nothing to switch off.
  it('shows the cover in Finder while Traktor sync is on too', async () => {
    const out = join(dir, 'out-traktor.flac')
    syncTraktor = true
    try {
      await convertWithFinderCovers(flac, out, cover)
    } finally {
      syncTraktor = false
    }
    expect(readFileSync(out).toString('latin1', 0, 4)).toBe('fLaC')
    expect(showsCoverInFinder(out)).toBe(true)
  })

  it('leaves the generic icon when the option is off', async () => {
    const out = join(dir, 'out-plain.flac')
    await convertAudio(flac, out, 'flac', meta, cover)
    expect(showsCoverInFinder(out)).toBe(false)
  })

  // Fixing tags on a FLAC that already carries art is the usual case, with no new cover
  // applied; requiring one left those files blank in Finder and users bolting the cover
  // on by hand afterwards, which is the chore this option exists to spare them.
  it('shows art the file already carries, with no new cover applied', async () => {
    const withArt = join(dir, 'has-art.flac')
    execFileSync(FF, [
      '-y',
      '-loglevel',
      'error',
      '-i',
      flac,
      '-i',
      cover,
      '-map',
      '0:a',
      '-map',
      '1:v',
      '-c:a',
      'flac',
      '-c:v',
      'copy',
      '-disposition:v',
      'attached_pic',
      withArt,
    ])
    const out = join(dir, 'out-existing-art.flac')
    await convertWithFinderCovers(withArt, out)
    expect(showsCoverInFinder(out)).toBe(true)
  })

  // Actualizar rewrites the file in place through the same conversion, so a cover changed
  // since the last run must replace the icon instead of leaving the old one up.
  it('replaces the icon with the new cover when a file is updated in place', async () => {
    const p = join(dir, 'in-place.flac')
    copyFileSync(flac, p)
    const blue = join(dir, 'blue.jpg')
    execFileSync(FF, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=300x300:d=1',
      '-frames:v',
      '1',
      blue,
    ])
    await setFinderIcon(p, blue)
    await convertWithFinderCovers(p, p, cover)
    expect(showsCoverInFinder(p)).toBe(true)
  })
})
