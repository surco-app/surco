import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { ByteVector, type Mpeg4AppleTag, StringType, File as TagFile } from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { emptyMetadata } from '../shared/metadata'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-m4a-atoms-'))
const ITUNES = 'com.apple.iTunes'
const meta = { ...emptyMetadata(), title: 'New title', artist: 'Artist' }

let n = 0
function aacWith(atoms: [string, string, string][]): string {
  const path = join(dir, `track${n++}.m4a`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-c:a',
    'aac',
    path,
  ])
  const f = TagFile.createFromPath(path)
  for (const [mean, name, value] of atoms)
    (f.tag as Mpeg4AppleTag).setItunesStrings(mean, name, value)
  f.save()
  f.dispose()
  return path
}

function atom(path: string, mean: string, name: string): string | undefined {
  const f = TagFile.createFromPath(path)
  try {
    return (f.tag as Mpeg4AppleTag).getFirstItunesString(mean, name)
  } finally {
    f.dispose()
  }
}

const box = (type: string) => ByteVector.fromString(type, StringType.Latin1)

function aacWithBoxes(texts: [string, string][], numbers: [string, number[]][] = []): string {
  const path = aacWith([])
  const f = TagFile.createFromPath(path)
  const apple = f.tag as Mpeg4AppleTag
  for (const [type, value] of texts) apple.setQuickTimeString(box(type), value)
  for (const [type, bytes] of numbers)
    apple.setQuickTimeData(box(type), [ByteVector.fromByteArray(new Uint8Array(bytes))], 21)
  f.save()
  f.dispose()
  return path
}

function boxText(path: string, type: string): string | undefined {
  const f = TagFile.createFromPath(path)
  try {
    return (f.tag as Mpeg4AppleTag).getFirstQuickTimeString(box(type))
  } finally {
    f.dispose()
  }
}

function boxBytes(path: string, type: string): number[] | undefined {
  const f = TagFile.createFromPath(path)
  try {
    const data = (f.tag as Mpeg4AppleTag).getFirstQuickTimeData(box(type), 21)
    return data ? Array.from(data.toByteArray()) : undefined
  } finally {
    f.dispose()
  }
}

const SMPB = ' 00000000 00000840 000001C0 0000000000015C00'

// Measured 23/11/2026 with the bundled ffmpeg: a same-format M4A update is a stream copy,
// so no backup is kept under "Only when the audio changes", yet the mp4 muxer wrote back
// none of the "----" atoms the file had: the gapless iTunSMPB, MusicBrainz ids and another
// program's own were all gone after a title edit.
describe('a same-format M4A update', () => {
  it('keeps the freeform atoms Surco does not manage', async () => {
    const src = aacWith([
      [ITUNES, 'iTunSMPB', SMPB],
      [ITUNES, 'MusicBrainz Track Id', 'mbid'],
      ['com.example.tagger', 'session', 'take 3'],
    ])
    await convertAudio(src, src, 'alac', meta)
    expect(atom(src, ITUNES, 'iTunSMPB')).toBe(SMPB)
    expect(atom(src, ITUNES, 'MusicBrainz Track Id')).toBe('mbid')
    expect(atom(src, 'com.example.tagger', 'session')).toBe('take 3')
  })

  // A field the editor emptied, under the name Surco writes it or an alias it reads, and
  // a tag the user deleted in the inspector, must not come back from the source.
  it('leaves out what the user cleared or deleted', async () => {
    const src = aacWith([
      [ITUNES, 'CATALOGNUMBER', 'CAT-1'],
      [ITUNES, 'LABEL', 'Label'],
      ['com.example.tagger', 'notes', 'junk'],
    ])
    await convertAudio(
      src,
      src,
      'alac',
      meta,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ['notes'],
    )
    expect(atom(src, ITUNES, 'CATALOGNUMBER')).toBeUndefined()
    expect(atom(src, ITUNES, 'LABEL')).toBeUndefined()
    expect(atom(src, 'com.example.tagger', 'notes')).toBeUndefined()
  })

  // Measured 23/11/2026 the same way: besides the "----" atoms, the update lost the sort
  // names, the classical work and movement, the category, purchase date, director and
  // narrator. Surco edits none of them, and Music sorts the library by the sort names.
  it('keeps the standard atoms Surco does not manage', async () => {
    const texts: [string, string][] = [
      ['sonm', 'Title, The'],
      ['soar', 'Artist, The'],
      ['soaa', 'Album Artist, The'],
      ['soal', 'Album, The'],
      ['soco', 'Composer, The'],
      ['sosn', 'Show, The'],
      ['©wrk', 'Symphony No. 5'],
      ['©mvn', 'Allegro con brio'],
      ['catg', 'Electronic'],
      ['purd', '2026-11-23 10:00:00'],
      ['©dir', 'Director'],
      ['©nrt', 'Narrator'],
    ]
    const numbers: [string, number[]][] = [
      ['©mvi', [0, 1]],
      ['©mvc', [0, 4]],
      ['shwm', [1]],
    ]
    const src = aacWithBoxes(texts, numbers)
    await convertAudio(src, src, 'alac', meta)
    for (const [type, value] of texts) expect(boxText(src, type), type).toBe(value)
    for (const [type, bytes] of numbers) expect(boxBytes(src, type), type).toEqual(bytes)
  })

  // The conductor and the label read back from ©con and ©pub, so a cleared one must not
  // return from the source; a sort name the user deleted in the inspector stays deleted.
  it('leaves out the standard atoms of a cleared field or a deleted tag', async () => {
    const src = aacWithBoxes([
      ['©con', 'Conductor'],
      ['©pub', 'Label'],
      ['sonm', 'Title, The'],
      ['soar', 'Artist, The'],
    ])
    await convertAudio(
      src,
      src,
      'alac',
      meta,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ['sort_name'],
    )
    expect(boxText(src, '©con')).toBeUndefined()
    expect(boxText(src, '©pub')).toBeUndefined()
    expect(boxText(src, 'sonm')).toBeUndefined()
    expect(boxText(src, 'soar')).toBe('Artist, The')
  })

  // iTunSMPB counts the encoder's priming and padding of the stream it was written for: on
  // a re-encoded stream it would be wrong, and that one keeps a backup anyway.
  it('does not carry them onto audio it re-encoded', async () => {
    const src = aacWith([[ITUNES, 'iTunSMPB', SMPB]])
    await convertAudio(src, src, 'alac', meta, undefined, {
      mode: 'peak',
      targetLufs: -14,
      peakDb: -1,
      truePeakDb: -1,
    })
    expect(atom(src, ITUNES, 'iTunSMPB')).not.toBe(SMPB)
  })
})
