import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  ByteVector,
  Id3v2FrameIdentifiers,
  Id3v2Settings,
  type Id3v2Tag,
  Id3v2UnknownFrame,
  type InfoTag,
  StringType,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { readTags } from './ffmpeg'
import { readGenreFrame, setGenreFrame } from './genreFrame'
import {
  buildTraktorTree,
  injectAiffPriv,
  injectWavPriv,
  storedTree,
  traktorCue,
} from './traktor4Fixture'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-genre-frame-'))
const WRITTEN = 'House; Deep House'
const DAMAGED = '(35) Deep House'
const sha1 = (b: Uint8Array) => createHash('sha1').update(b).digest('hex')
let seq = 0

function putTcon(file: string, text: string): void {
  const f = TagFile.createFromPath(file)
  try {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag
    const data = ByteVector.concatenate(
      StringType.UTF16,
      ByteVector.fromString(text, StringType.UTF16),
    )
    id3.addFrame(Id3v2UnknownFrame.fromData(Id3v2FrameIdentifiers.TCON, data))
    f.save()
  } finally {
    f.dispose()
  }
}

function oldSave(file: string): void {
  Id3v2Settings.useNonStandardV2V3GenreSeparators = true
  const f = TagFile.createFromPath(file)
  try {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag
    void id3.genres
    id3.comment = 'cue pass'
    f.save()
  } finally {
    f.dispose()
    Id3v2Settings.useNonStandardV2V3GenreSeparators = false
  }
}

function damaged(ext: 'mp3' | 'aiff' | 'wav'): string {
  const file = join(dir, `d-${seq++}.${ext}`)
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=1',
    ...(ext === 'mp3' ? ['-id3v2_version', '3', '-metadata', `genre=${WRITTEN}`] : []),
    ...(ext === 'wav' ? ['-metadata', `genre=${WRITTEN}`] : []),
    file,
  ])
  if (ext !== 'mp3') {
    const tree = buildTraktorTree([traktorCue('Intro', 0, 10000, 0)])
    if (ext === 'aiff') injectAiffPriv(file, tree)
    else injectWavPriv(file, tree)
    putTcon(file, WRITTEN)
  }
  oldSave(file)
  return file
}

function infoGenre(file: string): string | undefined {
  const f = TagFile.createFromPath(file)
  try {
    return (f.getTag(TagTypes.RiffInfo, false) as InfoTag | null)?.getValuesAsStrings('IGNR')[0]
  } finally {
    f.dispose()
  }
}

afterEach(() => {
  Id3v2Settings.useNonStandardV2V3GenreSeparators = false
})

// The damage hides from every reader the review uses: ffprobe sees "House" and TagLib with
// today's setting reads "House  Deep House". Only the frame's own bytes tell it apart, and
// the repair may only replace those bytes when they are still what the scan saw.
describe('readGenreFrame', () => {
  it.each(['mp3', 'aiff', 'wav'] as const)('reads the bytes the damage left in a %s', (ext) => {
    expect(readGenreFrame(damaged(ext))?.raw).toBe(DAMAGED)
  })

  it("keeps a WAV's INFO genre, which the damage never touched", () => {
    expect(readGenreFrame(damaged('wav'))).toEqual({ raw: DAMAGED, info: WRITTEN })
  })

  it('is null for a file with no ID3v2.3 genre', () => {
    const file = join(dir, `plain-${seq++}.mp3`)
    execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anoisesrc=d=1', file])
    expect(readGenreFrame(file)).toBeNull()
  })
})

describe('setGenreFrame', () => {
  it.each(['mp3', 'aiff', 'wav'] as const)('writes the genre back as plain text in a %s', (ext) => {
    const file = damaged(ext)
    const tree = storedTree(file)
    expect(setGenreFrame(file, [{ field: 'genre', from: DAMAGED, to: WRITTEN }])).toEqual([
      'written',
    ])
    expect(readGenreFrame(file)?.raw).toBe(WRITTEN)
    expect(sha1(storedTree(file) ?? new Uint8Array())).toBe(sha1(tree ?? new Uint8Array()))
  })

  it('reads back through ffprobe as the genre the user wrote', async () => {
    const file = damaged('mp3')
    expect((await readTags(file)).genre).toBe('House')
    setGenreFrame(file, [{ field: 'genre', from: DAMAGED, to: WRITTEN }])
    expect((await readTags(file)).genre).toBe(WRITTEN)
  })

  it('leaves the file byte for byte when its genre is no longer what the scan read', () => {
    const file = damaged('mp3')
    const before = sha1(readFileSync(file))
    expect(setGenreFrame(file, [{ field: 'genre', from: 'House', to: WRITTEN }])).toEqual([
      'unchanged',
    ])
    expect(sha1(readFileSync(file))).toBe(before)
  })

  it("keeps a WAV's INFO genre as it was", () => {
    const file = damaged('wav')
    setGenreFrame(file, [{ field: 'genre', from: DAMAGED, to: WRITTEN }])
    expect(infoGenre(file)?.replace(/\0+$/, '')).toBe(WRITTEN)
  })
})
