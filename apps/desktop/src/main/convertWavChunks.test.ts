import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio, readMeta } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-wav-chunks-'))

const meta: TrackMetadata = {
  title: 'New Title',
  artist: 'Artist',
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

interface Chunk {
  id: string
  body: Buffer
}

function chunksOf(file: Buffer): Chunk[] {
  const chunks: Chunk[] = []
  let pos = 12
  while (pos + 8 <= file.length) {
    const size = file.readUInt32LE(pos + 4)
    chunks.push({
      id: file.toString('latin1', pos, pos + 4),
      body: file.subarray(pos + 8, pos + 8 + size),
    })
    pos += 8 + size + (size & 1)
  }
  return chunks
}

function riff(chunks: Chunk[]): Buffer {
  const parts = chunks.flatMap(({ id, body }) => {
    const head = Buffer.alloc(8)
    head.write(id, 0, 'latin1')
    head.writeUInt32LE(body.length, 4)
    return body.length & 1 ? [head, body, Buffer.alloc(1)] : [head, body]
  })
  const head = Buffer.from('RIFF\0\0\0\0WAVE', 'latin1')
  const out = Buffer.concat([head, ...parts])
  out.writeUInt32LE(out.length - 8, 4)
  return out
}

function list(type: string, ...subs: Chunk[]): Chunk {
  return { id: 'LIST', body: Buffer.concat([Buffer.from(type, 'latin1'), riff(subs).subarray(12)]) }
}

const key = (c: Chunk): string =>
  c.id === 'LIST' ? `LIST/${c.body.toString('latin1', 0, 4)}` : c.id

// What a DJ's or a studio's WAV carries besides the audio: a Broadcast WAV header, an
// iXML block (odd length, so its pad byte is exercised), Acidized tempo info, and after
// the audio the markers and loops samplers and DAWs read, with their labels.
const extras: Chunk[] = [
  {
    id: 'bext',
    body: Buffer.concat([Buffer.from('Field recording', 'latin1'), Buffer.alloc(587)]),
  },
  { id: 'iXML', body: Buffer.from('<BWFXML><PROJECT>set</PROJECT></BWFXML>', 'latin1') },
  { id: 'acid', body: Buffer.alloc(24, 3) },
]
const after: Chunk[] = [
  {
    id: 'cue ',
    body: Buffer.concat([
      Buffer.from([1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]),
      Buffer.from('data', 'latin1'),
      Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0x10, 0x27, 0, 0]),
    ]),
  },
  list('adtl', {
    id: 'labl',
    body: Buffer.concat([Buffer.from([1, 0, 0, 0]), Buffer.from('Drop\0', 'latin1')]),
  }),
  { id: 'smpl', body: Buffer.alloc(60, 7) },
]

function cuedWav(name: string): string {
  const plain = join(dir, `plain-${name}`)
  execFileSync(FF, [
    '-v',
    'quiet',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-y',
    plain,
  ])
  const own = chunksOf(readFileSync(plain))
  const fmt = own.find((c) => c.id === 'fmt ') as Chunk
  const data = own.find((c) => c.id === 'data') as Chunk
  const info = list('INFO', { id: 'INAM', body: Buffer.from('Old Title\0', 'latin1') })
  const path = join(dir, name)
  writeFileSync(path, riff([fmt, ...extras, info, data, ...after]))
  return path
}

// Updating a WAV's tags passes it through ffmpeg, which writes a fresh file with only the
// format, its own INFO tags and the audio. Everything else was gone: the markers and loops
// a sampler or DAW placed, the Broadcast WAV header, the iXML of a recorder. And because
// the audio itself is copied through, the backup policy "only when the audio changes"
// kept no copy of what was lost.
describe('a WAV tag update', () => {
  it('keeps the chunks it does not rewrite, byte for byte', async () => {
    const src = cuedWav('update.wav')
    const before = chunksOf(readFileSync(src))
    await convertAudio(src, src, 'wav', meta)

    const file = readFileSync(src)
    const now = chunksOf(file)
    for (const chunk of [...extras, ...after]) {
      const found = now.find((c) => key(c) === key(chunk))
      expect(found?.body.equals(chunk.body), key(chunk)).toBe(true)
    }
    expect(
      now
        .find((c) => c.id === 'data')
        ?.body.equals(before.find((c) => c.id === 'data')?.body as Buffer),
    ).toBe(true)
    expect((await readMeta(src)).tags.title).toBe('New Title')
    expect(file.readUInt32LE(4)).toBe(file.length - 8)
  })

  it('does not double a chunk on a second update', async () => {
    const src = cuedWav('twice.wav')
    await convertAudio(src, src, 'wav', meta)
    await convertAudio(src, src, 'wav', meta)

    const ids = chunksOf(readFileSync(src)).map(key)
    for (const chunk of [...extras, ...after])
      expect(ids.filter((k) => k === key(chunk))).toHaveLength(1)
  })
})
