import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { File as TagFile, TagTypes, type XiphComment } from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { emptyMetadata } from '../shared/metadata'
import type { TrackMetadata } from '../shared/types'
import { convertAudio, readMeta } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-flac-multi-'))

let n = 0
function flacWith(fields: Record<string, string[]>, encode: string[] = []): string {
  const path = join(dir, `track${n++}.flac`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    ...encode,
    path,
  ])
  const f = TagFile.createFromPath(path)
  const xiph = f.getTag(TagTypes.Xiph, true) as XiphComment
  for (const [name, values] of Object.entries(fields)) xiph.setFieldAsStrings(name, ...values)
  f.save()
  f.dispose()
  return path
}

function field(path: string, name: string): string[] {
  const f = TagFile.createFromPath(path)
  try {
    return (f.getTag(TagTypes.Xiph, false) as XiphComment | null)?.getField(name) ?? []
  } finally {
    f.dispose()
  }
}

async function editedTitle(path: string): Promise<TrackMetadata> {
  return { ...emptyMetadata(), ...(await readMeta(path)).tags, title: 'New title' }
}

const update = (
  path: string,
  meta: TrackMetadata,
  options: { clearExtras?: boolean; foreignRemoved?: string[] } = {},
) =>
  convertAudio(
    path,
    path,
    'flac',
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
    options.clearExtras,
    options.foreignRemoved,
  )

// Measured 23/11/2026 with the bundled ffmpeg: its FLAC reader folds the entries of a
// repeated Vorbis comment into one value joined by ';', and the muxer writes that back, so
// a title edit turned another program's two MUSICBRAINZ_ARTISTID entries into one id
// nothing can look up. Tags Surco does not manage are the DJ's own and must come out of
// Surco as they went in, whether the audio was copied or re-encoded.
describe('a FLAC written from a FLAC', () => {
  const MULTI = {
    MUSICBRAINZ_ARTISTID: ['id-1', 'id-2'],
    ARTISTS: ['Ann', 'Bob'],
    X: ['7', '8'],
  }

  it('keeps every entry of a repeated comment Surco does not manage', async () => {
    const src = flacWith({ ...MULTI, SINGLE: ['one'] })
    await update(src, await editedTitle(src))
    for (const [name, values] of Object.entries(MULTI))
      expect(field(src, name), name).toEqual(values)
    expect(field(src, 'SINGLE')).toEqual(['one'])
    expect(field(src, 'TITLE')).toEqual(['New title'])
  })

  it('keeps them when the conversion re-encodes the audio', async () => {
    const src = flacWith(MULTI, ['-ar', '48000', '-sample_fmt', 's32'])
    await convertAudio(src, src, 'flac', await editedTitle(src), undefined, undefined, undefined, {
      bitDepth: '16',
      sampleRate: '44100',
    })
    for (const [name, values] of Object.entries(MULTI))
      expect(field(src, name), name).toEqual(values)
  })

  // A field Surco writes holds what the editor holds, one value; the source's entries must
  // not come back over it.
  it('leaves a field Surco writes as Surco wrote it', async () => {
    const src = flacWith({ GENRE: ['House', 'Techno'], STYLE: ['Deep', 'Dark'] })
    const meta = { ...(await editedTitle(src)), style: 'Minimal' }
    await update(src, meta)
    expect(field(src, 'GENRE')).toEqual(['House;Techno'])
    expect(field(src, 'STYLE')).toEqual(['Minimal'])
  })

  it('does not bring back a tag the DJ deleted or a file the DJ emptied', async () => {
    const deleted = flacWith(MULTI)
    await update(deleted, await editedTitle(deleted), { foreignRemoved: ['x'] })
    expect(field(deleted, 'X')).toEqual([])
    expect(field(deleted, 'ARTISTS')).toEqual(['Ann', 'Bob'])

    const emptied = flacWith(MULTI)
    await update(emptied, emptyMetadata(), { clearExtras: true })
    for (const name of Object.keys(MULTI)) expect(field(emptied, name), name).toEqual([])
  })
})
