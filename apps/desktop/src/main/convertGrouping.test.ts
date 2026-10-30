import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { File as TagFile } from 'node-taglib-sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { emptyMetadata } from '../shared/metadata'
import type { OutputFormat, TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { snapshotTags } from './tagSnapshot'
import { readItunesGrouping, writeTags } from './tags'
import { checkFile, fileReaders } from './verifyFile'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-grouping-'))
const wav = join(dir, 'in.wav')
const flac = join(dir, 'in.flac')
const kick = 'aevalsrc=0.9*sin(2*PI*55*t)*exp(-4*mod(t\\,0.5)):s=44100:d=3'

beforeAll(() => {
  execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', kick, '-ac', '2', wav])
  execFileSync(FF, ['-y', '-v', 'error', '-i', wav, '-metadata', 'GROUPING=Old', flac])
})

let n = 0
async function converted(source: string, format: OutputFormat, over: Partial<TrackMetadata>) {
  const meta = { ...emptyMetadata(), title: 'T', grouping: 'Wärm Up', ...over }
  const out = join(dir, `out-${n++}.${format}`)
  const { written } = await convertAudio(source, out, format, meta)
  const check = await checkFile(
    {
      path: out,
      ext: written.plan.ext,
      codec: written.plan.codec,
      bitDepth: written.plan.bitDepth,
      samplesKept: written.samplesKept,
      sourcePcm: written.sourcePcm,
      sourceDurationSec: written.sourceDurationSec,
      trimmedSec: written.trimmedSec,
      tags: meta,
      cover: 'untouched',
      ...(written.proven ? { proven: written.proven } : {}),
    },
    fileReaders,
  )
  return { out, check }
}

// ffmpeg writes a grouping as TXXX "grouping", which no DJ tool reads: Traktor and every
// other tagger look in TIT1, Apple Music in its own GRP1. A track with no rating or
// comment skipped the TagLib pass that writes those, so its grouping reached nobody.
describe('convertAudio — grouping on ID3 targets', () => {
  it.each([
    ['mp3', 'no rating or comment', {}],
    ['aiff', 'no rating or comment', {}],
    ['mp3', 'a comment', { comment: 'C' }],
    ['aiff', 'a comment', { comment: 'C' }],
  ] as const)(
    'a %s with %s carries the grouping in TIT1 and GRP1 only',
    async (format, _, over) => {
      const { out, check } = await converted(wav, format, over)
      const lines = snapshotTags(out)
      expect(lines).toContain('id3 TIT1=Wärm Up')
      expect(lines).toContain('id3 GRP1=Wärm Up')
      expect(lines.filter((l) => /grouping/i.test(l))).toEqual([])
      expect(readItunesGrouping(out)).toBe('Wärm Up')
      expect(check.state, JSON.stringify(check.detail)).toBe('ok')
    },
    30_000,
  )

  it('a FLAC grouping changed on the way to MP3 leaves no trace of the old one', async () => {
    const { out } = await converted(flac, 'mp3', {})
    expect(snapshotTags(out).filter((l) => l.includes('Old'))).toEqual([])
  }, 30_000)

  it('a grouping cleared on an MP3 that had one leaves neither frame', async () => {
    const { out } = await converted(wav, 'mp3', {})
    writeTags(out, { ...emptyMetadata(), title: 'T', grouping: '' })
    expect(snapshotTags(out).filter((l) => /TIT1|GRP1/.test(l))).toEqual([])
    expect(readItunesGrouping(out)).toBe('')
  }, 30_000)

  // Apple Music reads no tags from a WAV at import, so a GRP1 there would only shadow the
  // TIT1 another tool edits: Surco reads GRP1 first and would write the old value back.
  it('a WAV carries the grouping in TIT1 alone, and an edit to TIT1 elsewhere reads back', async () => {
    const { out, check } = await converted(wav, 'wav', {})
    expect(check.state, JSON.stringify(check.detail)).toBe('ok')
    expect(snapshotTags(out).filter((l) => /TIT1|GRP1|grouping/i.test(l))).toEqual([
      'id3 TIT1=Wärm Up',
    ])
    const f = TagFile.createFromPath(out)
    f.tag.grouping = 'Peak'
    f.save()
    f.dispose()
    expect(readItunesGrouping(out)).toBe('Peak')
  }, 30_000)
})
