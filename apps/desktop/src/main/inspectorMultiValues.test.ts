import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { type Mpeg4AppleTag, File as TagFile, TagTypes, type XiphComment } from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { readMeta } from './ffmpeg'
import { encodeSine } from './sineTone.fixture'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-inspector-multi-'))
let n = 0

const syncsafe = (x: number) =>
  Buffer.from([(x >> 21) & 0x7f, (x >> 14) & 0x7f, (x >> 7) & 0x7f, x & 0x7f])

function frame(version: 3 | 4, id: string, values: string[]): Buffer {
  const body = Buffer.concat([Buffer.from([0]), Buffer.from(values.join('\0'), 'latin1')])
  const head = Buffer.alloc(10)
  head.write(id, 0, 'latin1')
  if (version === 4) syncsafe(body.length).copy(head, 4)
  else head.writeUInt32BE(body.length, 4)
  return Buffer.concat([head, body])
}

// Built byte by byte, as Picard and mp3tag write them.
function id3Tagged(version: 3 | 4, frames: Buffer[]): string {
  const body = Buffer.concat([frame(version, 'TIT2', ['Title']), ...frames])
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

async function shown(path: string): Promise<Record<string, string>> {
  return Object.fromEntries((await readMeta(path)).foreignTags.map((t) => [t.name, t.value]))
}

const PEOPLE = ['producer', 'Ann', 'mix engineer', 'Bob']
const MUSICIANS = ['piano', 'Cid', 'bass', 'Dee']

// The inspector lists a FLAC's repeated comment with every value, joined by ';', but an ID3
// frame or TXXX by its first value and an M4A freeform atom by its last, and a v2.3 IPLS
// not at all: a DJ about to delete a tag saw a fraction of what the delete would take.
describe('the inspector', () => {
  it('lists a FLAC repeated comment with every value, the form the others follow', async () => {
    const path = encodeSine(dir, `flac${n++}`, 'flac')
    const f = TagFile.createFromPath(path)
    ;(f.getTag(TagTypes.Xiph, true) as XiphComment).setFieldAsStrings('TIPL', ...PEOPLE)
    f.save()
    f.dispose()
    expect((await shown(path)).TIPL).toBe(PEOPLE.join(';'))
  })

  it('lists the involved people and musicians of an ID3v2.4 tag whole', async () => {
    const tags = await shown(
      id3Tagged(4, [
        frame(4, 'TIPL', PEOPLE),
        frame(4, 'TMCL', MUSICIANS),
        frame(4, 'TXXX', ['VINYL', 'VG', 'NM']),
      ]),
    )
    expect(tags.TIPL).toBe(PEOPLE.join(';'))
    expect(tags.TMCL).toBe(MUSICIANS.join(';'))
    expect(tags.VINYL).toBe('VG;NM')
  })

  it('lists the involved people of an ID3v2.3 IPLS whole', async () => {
    expect((await shown(id3Tagged(3, [frame(3, 'IPLS', PEOPLE)]))).TIPL).toBe(PEOPLE.join(';'))
  })

  it('lists a freeform atom of an M4A with every value', async () => {
    const path = join(dir, `src${n++}.m4a`)
    execFileSync(FF, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=d=1',
      '-c:a',
      'aac',
      path,
    ])
    const f = TagFile.createFromPath(path)
    ;(f.tag as Mpeg4AppleTag).setItunesStrings(
      'com.apple.iTunes',
      'MusicBrainz Artist Id',
      'id-1',
      'id-2',
    )
    f.save()
    f.dispose()
    expect((await shown(path))['MusicBrainz Artist Id']).toBe('id-1;id-2')
  })
})
