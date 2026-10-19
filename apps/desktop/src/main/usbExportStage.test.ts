import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { anlzSections } from './anlz'
import type { ExportSelection, ExportTrack } from './usbExportSource'
import { smallCoverPath, stageExport } from './usbExportStage'

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}
const anlzFile = (...sections: Buffer[]): Buffer => {
  const out = Buffer.concat([Buffer.from('PMAI'), u32(28), u32(0), Buffer.alloc(16), ...sections])
  out.writeUInt32BE(out.length, 8)
  return out
}
const pwav = Buffer.concat([
  Buffer.from('PWAV'),
  u32(20),
  u32(420),
  u32(400),
  u32(0x10000),
  Buffer.alloc(400, 0xbf),
])

function track(over: Partial<ExportTrack>): ExportTrack {
  return {
    id: '1',
    path: '',
    title: 'T',
    artist: '',
    album: '',
    genre: '',
    label: '',
    remixer: '',
    composer: '',
    mix: '',
    key: '',
    fileType: 11,
    lengthSec: 1,
    bpm: 120,
    bitRate: 0,
    sampleRate: 44100,
    bitDepth: 16,
    rating: 0,
    year: 0,
    trackNo: 0,
    discNo: 0,
    dateAdded: '',
    playCount: 0,
    comment: '',
    analysisPath: '',
    imagePath: '',
    separator: false,
    streaming: false,
    cues: [],
    ...over,
  }
}

let root = ''
let share = ''
let settings = ''
let music = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'usb-stage-'))
  share = join(root, 'share')
  settings = join(root, 'rekordbox6')
  music = join(root, 'music')
  for (const d of [share, settings, music]) mkdirSync(d, { recursive: true })
  const anlz = join(share, 'PIONEER/USBANLZ/51d/3f604')
  mkdirSync(anlz, { recursive: true })
  writeFileSync(join(anlz, 'ANLZ0000.DAT'), anlzFile(pwav))
  writeFileSync(join(anlz, 'ANLZ0000.EXT'), anlzFile())
  writeFileSync(join(anlz, 'ANLZ0000.2EX'), anlzFile())
  mkdirSync(join(share, 'PIONEER/Artwork/00a/b1'), { recursive: true })
  writeFileSync(join(share, 'PIONEER/Artwork/00a/b1/artwork.jpg'), 'big')
  writeFileSync(join(share, 'PIONEER/Artwork/00a/b1/artwork_s.jpg'), 'small')
  writeFileSync(join(music, 'a.wav'), Buffer.alloc(1234))
  for (const f of [
    'MYSETTING.DAT',
    'MYSETTING2.DAT',
    'DJMMYSETTING.DAT',
    'djprofile.nxs',
    'other.txt',
  ])
    writeFileSync(join(settings, f), f)
})

const SEL = (): ExportSelection => {
  const a = track({
    id: '101',
    path: join(music, 'a.wav'),
    analysisPath: '/PIONEER/USBANLZ/51d/3f604/ANLZ0000.DAT',
    imagePath: '/PIONEER/Artwork/00a/b1/artwork.jpg',
  })
  const gone = track({ id: '102', path: join(music, 'gone.wav') })
  const stream = track({ id: '103', path: 'spotify:x', streaming: true })
  return {
    playlists: [{ id: 'p', name: 'Makina', folders: [], trackIds: ['101', '102', '103'] }],
    tracks: [a, gone, stream],
  }
}

describe('stageExport', () => {
  it('copies the analysis for baken under USBANLZ, masking the vocal section', async () => {
    const s = await stageExport({
      stickHasDevSetting: false,
      sel: SEL(),
      shareDir: share,
      settingsSource: settings,
      dir: join(root, 'stage'),
    })
    const twoEx = readFileSync(join(s.anlzDir, '51d/3f604/ANLZ0000.2EX'))
    expect(anlzSections(twoEx).map((x) => x.tag)).toEqual(['PVDI'])
    expect(existsSync(join(s.anlzDir, '51d/3f604/ANLZ0000.DAT'))).toBe(true)
    expect(existsSync(join(s.anlzDir, '51d/3f604/ANLZ0000.EXT'))).toBe(true)
  })

  // The originals in rekordbox's share folder must come out byte for byte as they went in.
  it('never changes rekordbox own files', async () => {
    const before = readFileSync(join(share, 'PIONEER/USBANLZ/51d/3f604/ANLZ0000.2EX'))
    await stageExport({
      stickHasDevSetting: false,
      sel: SEL(),
      shareDir: share,
      settingsSource: settings,
      dir: join(root, 'stage'),
    })
    expect(readFileSync(join(share, 'PIONEER/USBANLZ/51d/3f604/ANLZ0000.2EX'))).toEqual(before)
  })

  it('names the artwork by TrackID for baken', async () => {
    const s = await stageExport({
      stickHasDevSetting: false,
      sel: SEL(),
      shareDir: share,
      settingsSource: settings,
      dir: join(root, 'stage'),
    })
    expect(readFileSync(join(s.artworkDir, '101.jpg'), 'utf8')).toBe('big')
    expect(s.covers.get('101')).toBe(
      `data:image/jpeg;base64,${Buffer.from('small').toString('base64')}`,
    )
  })

  // A file that is gone (or on a NAS that is asleep) and a streaming row stay out of the
  // XML; the rest still exports.
  it('leaves out what has no file, and says which', async () => {
    const s = await stageExport({
      stickHasDevSetting: false,
      sel: SEL(),
      shareDir: share,
      settingsSource: settings,
      dir: join(root, 'stage'),
    })
    expect(s.included).toEqual(['101'])
    expect(s.missing).toEqual(['102'])
    expect(s.sizes.get('101')).toBe(1234)
    const xml = readFileSync(s.xml, 'utf8')
    expect(xml).toContain('Size="1234"')
    expect(xml).not.toContain('TrackID="102"')
    expect(xml).not.toContain('TrackID="103"')
  })

  it('keeps the waveform preview for the export list', async () => {
    const s = await stageExport({
      stickHasDevSetting: false,
      sel: SEL(),
      shareDir: share,
      settingsSource: settings,
      dir: join(root, 'stage'),
    })
    expect(s.waves.get('101')).toHaveLength(100)
    expect(s.waves.get('101')?.[0]).toBe(1)
  })

  it('copies only the My Settings files baken reads', async () => {
    const s = await stageExport({
      stickHasDevSetting: false,
      sel: SEL(),
      shareDir: share,
      settingsSource: settings,
      dir: join(root, 'stage'),
    })
    expect(s.settingsDir).not.toBeNull()
    expect(existsSync(join(s.settingsDir as string, 'MYSETTING.DAT'))).toBe(true)
    expect(existsSync(join(s.settingsDir as string, 'other.txt'))).toBe(false)
  })

  // baken refuses to run without the three required files; without them the stick goes
  // with --no-settings and the player keeps its own.
  it('has no settings folder when rekordbox wrote none', async () => {
    const s = await stageExport({
      stickHasDevSetting: false,
      sel: SEL(),
      shareDir: share,
      settingsSource: join(root, 'nowhere'),
      dir: join(root, 'stage'),
    })
    expect(s.settingsDir).toBeNull()
  })

  // baken's settings copy overwrites whatever it is given, so a DEVSETTING.DAT the stick
  // already has must never be among the staged files.
  it('leaves DEVSETTING.DAT out when the stick already has one', async () => {
    writeFileSync(join(settings, 'DEVSETTING.DAT'), 'dev')
    const fresh = await stageExport({
      stickHasDevSetting: false,
      sel: SEL(),
      shareDir: share,
      settingsSource: settings,
      dir: join(root, 'stage-a'),
    })
    expect(existsSync(join(fresh.settingsDir as string, 'DEVSETTING.DAT'))).toBe(true)
    const kept = await stageExport({
      stickHasDevSetting: true,
      sel: SEL(),
      shareDir: share,
      settingsSource: settings,
      dir: join(root, 'stage-b'),
    })
    expect(existsSync(join(kept.settingsDir as string, 'DEVSETTING.DAT'))).toBe(false)
    expect(existsSync(join(kept.settingsDir as string, 'MYSETTING.DAT'))).toBe(true)
  })

  // maskVocals appends a PVDI to anything without one and throws on tiny buffers; a file
  // that is not an analysis (truncated, foreign) goes to the stick exactly as it is.
  it('copies a 2EX that is not a PMAI file unchanged', async () => {
    writeFileSync(join(share, 'PIONEER/USBANLZ/51d/3f604/ANLZ0000.2EX'), 'junk')
    const s = await stageExport({
      stickHasDevSetting: false,
      sel: SEL(),
      shareDir: share,
      settingsSource: settings,
      dir: join(root, 'stage'),
    })
    expect(readFileSync(join(s.anlzDir, '51d/3f604/ANLZ0000.2EX'), 'utf8')).toBe('junk')
  })

  // A truncated section header makes the readers throw; one bad analysis must not stop the
  // other tracks, and the track still exports without grid or waveform.
  it('stages a track whose analysis is corrupt as one without analysis', async () => {
    const bad = anlzFile(Buffer.concat([Buffer.from('PQTZ'), u32(12), u32(12)]))
    writeFileSync(join(share, 'PIONEER/USBANLZ/51d/3f604/ANLZ0000.DAT'), bad)
    const s = await stageExport({
      stickHasDevSetting: false,
      sel: SEL(),
      shareDir: share,
      settingsSource: settings,
      dir: join(root, 'stage'),
    })
    expect(s.included).toEqual(['101'])
    expect(s.waves.has('101')).toBe(false)
  })

  // The path comes from master.db; one that climbs out must never reach outside the staged
  // folder, nor read outside rekordbox's share folder.
  it('ignores an analysis path that climbs out of USBANLZ', async () => {
    const sel = SEL()
    sel.tracks[0].analysisPath = '/PIONEER/USBANLZ/../../../escape/ANLZ0000.DAT'
    mkdirSync(join(root, 'escape'), { recursive: true })
    writeFileSync(join(root, 'escape', 'ANLZ0000.DAT'), anlzFile(pwav))
    const s = await stageExport({
      stickHasDevSetting: false,
      sel,
      shareDir: share,
      settingsSource: settings,
      dir: join(root, 'stage'),
    })
    expect(existsSync(join(root, 'stage', 'escape'))).toBe(false)
    expect(s.waves.has('101')).toBe(false)
    expect(s.included).toEqual(['101'])
  })

  it('finds rekordbox small thumbnail beside the cover', () => {
    expect(smallCoverPath('/PIONEER/Artwork/00a/b1/artwork.jpg')).toBe(
      '/PIONEER/Artwork/00a/b1/artwork_s.jpg',
    )
  })
})
