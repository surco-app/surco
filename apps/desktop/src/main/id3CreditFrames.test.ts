import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type Id3v2Tag,
  type Id3v2TextInformationFrame,
  type Mpeg4AppleTag,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { OutputFormat } from '../shared/types'
import { convertAudio, readMeta } from './ffmpeg'
import { encodeSine } from './sineTone.fixture'

const dir = mkdtempSync(join(tmpdir(), 'surco-credit-frames-'))
let n = 0

const CREDITS = {
  TSST: ['Disc one'],
  TPRO: ['2020 Label'],
  TIPL: ['producer', 'Ann', 'mix engineer', 'Bob'],
  TMCL: ['piano', 'Cid', 'bass', 'Dee'],
}

const syncsafe = (x: number) =>
  Buffer.from([(x >> 21) & 0x7f, (x >> 14) & 0x7f, (x >> 7) & 0x7f, x & 0x7f])

// Built byte by byte, as Picard and mp3tag write them, so no fixture goes through the
// TagLib the fix patches: v2.4 frames hold null-separated values, and v2.3 keeps the
// involved people in IPLS, pairs separated by nulls too.
function frame(version: 3 | 4, id: string, values: string[]): Buffer {
  const body = Buffer.concat([Buffer.from([0]), Buffer.from(values.join('\0'), 'latin1')])
  const head = Buffer.alloc(10)
  head.write(id, 0, 'latin1')
  if (version === 4) syncsafe(body.length).copy(head, 4)
  else head.writeUInt32BE(body.length, 4)
  return Buffer.concat([head, body])
}

function tagged(version: 3 | 4): string {
  const frames =
    version === 4
      ? Object.entries(CREDITS).map(([id, values]) => frame(4, id, values))
      : [frame(3, 'IPLS', CREDITS.TIPL)]
  const body = Buffer.concat([frame(version, 'TIT2', ['Old title']), ...frames])
  const tag = Buffer.concat([
    Buffer.from('ID3'),
    Buffer.from([version, 0, 0]),
    syncsafe(body.length),
    body,
  ])
  const path = join(dir, `src${n++}.mp3`)
  writeFileSync(path, Buffer.concat([tag, readFileSync(encodeSine(dir, `audio${n++}`, 'mp3'))]))
  return path
}

function credits(path: string): Record<string, string[]> {
  const f = TagFile.createFromPath(path)
  try {
    const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment | null
    const apple = path.endsWith('.m4a') ? (f.tag as Mpeg4AppleTag) : null
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    return Object.fromEntries(
      Object.keys(CREDITS).map((id) => [
        id,
        xiph
          ? xiph.getField(id)
          : apple
            ? apple.getItunesStrings('com.apple.iTunes', id)
            : (id3?.frames
                .filter((fr) => fr.frameId.toString() === id)
                .flatMap((fr) => (fr as Id3v2TextInformationFrame).text) ?? []),
      ]),
    )
  } finally {
    f.dispose()
  }
}

const ipls = (path: string) => readFileSync(path).includes('IPLS\0')

async function convert(src: string, target: OutputFormat): Promise<string> {
  const out = join(dir, `out${n++}.${target === 'alac' ? 'm4a' : target}`)
  await convertAudio(src, out, target, { ...(await readMeta(src)).tags, title: 'New title' })
  return out
}

// TagLib wrote TSST, TPRO and TMCL on ID3v2.4 only and left them out of the v2.3 tag every
// update pins, turned the involved people into one "producer/Ann/…" string there, read a
// v2.3 IPLS as its first word, and dropped TMCL from any tag it saved. ffmpeg kept the first
// value of each and none in a WAV. The disc subtitle, the credits and the musicians are the
// DJ's own tags and have to come through whole.
describe('a credited MP3', () => {
  it('keeps its ID3v2.4 credits through any TagLib save', () => {
    const path = tagged(4)
    const f = TagFile.createFromPath(path)
    f.save()
    f.dispose()
    expect(credits(path)).toEqual(CREDITS)
  })

  it.each(['mp3', 'aiff', 'wav', 'flac', 'alac'] as OutputFormat[])(
    'keeps its ID3v2.4 credits converted to %s',
    async (target) => {
      const out = await convert(tagged(4), target)
      expect(credits(out)).toEqual(CREDITS)
      if (target !== 'flac' && target !== 'alac') expect(ipls(out)).toBe(true)
    },
  )

  it.each(['mp3', 'aiff', 'wav', 'flac'] as OutputFormat[])(
    'keeps its ID3v2.3 involved people converted to %s',
    async (target) => {
      const out = await convert(tagged(3), target)
      expect(credits(out).TIPL).toEqual(CREDITS.TIPL)
    },
  )
})
