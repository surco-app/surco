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
const dir = mkdtempSync(join(tmpdir(), 'surco-flac-blocks-'))

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

const APPLICATION = 2
const CUESHEET = 5

interface Block {
  type: number
  body: Buffer
}

function blocksOf(file: Buffer): { blocks: Block[]; audioAt: number } {
  const blocks: Block[] = []
  let pos = 4
  for (;;) {
    const head = file[pos]
    const size = file.readUIntBE(pos + 1, 3)
    blocks.push({ type: head & 0x7f, body: file.subarray(pos + 4, pos + 4 + size) })
    pos += 4 + size
    if (head & 0x80) return { blocks, audioAt: pos }
  }
}

function flac(blocks: Block[], audio: Buffer): Buffer {
  const parts = blocks.map(({ type, body }, i) => {
    const head = Buffer.alloc(4)
    head[0] = type | (i === blocks.length - 1 ? 0x80 : 0)
    head.writeUIntBE(body.length, 1, 3)
    return Buffer.concat([head, body])
  })
  return Buffer.concat([Buffer.from('fLaC', 'latin1'), ...parts, audio])
}

// A CD rip's embedded cue sheet: one track at sample 0 and the lead-out, as foobar2000
// and EAC write it for a single-file image.
function cueSheet(): Buffer {
  const track = (offset: bigint, number: number, indices: number) => {
    const t = Buffer.alloc(36)
    t.writeBigUInt64BE(offset, 0)
    t[8] = number
    t[35] = indices
    return t
  }
  const index = Buffer.alloc(12)
  index[8] = 1
  return Buffer.concat([
    Buffer.alloc(128),
    Buffer.alloc(8),
    Buffer.alloc(259),
    Buffer.from([2]),
    track(0n, 1, 1),
    index,
    track(88200n, 255, 0),
  ])
}

function application(id: string, bytes: number): Buffer {
  return Buffer.concat([Buffer.from(id, 'latin1'), Buffer.alloc(bytes, 0x5a)])
}

function sourceWith(name: string, extra: Block[]): string {
  const plain = join(dir, `plain-${name}`)
  execFileSync(FF, [
    '-v',
    'quiet',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-y',
    plain,
  ])
  const file = readFileSync(plain)
  const { blocks, audioAt } = blocksOf(file)
  const path = join(dir, name)
  writeFileSync(path, flac([blocks[0], ...extra, ...blocks.slice(1)], file.subarray(audioAt)))
  return path
}

const bodyOf = (path: string, type: number): Buffer[] =>
  blocksOf(readFileSync(path))
    .blocks.filter((b) => b.type === type)
    .map((b) => b.body)

// Updating a FLAC's tags passes it through ffmpeg, which writes only the stream info, its
// Vorbis comment and padding. A CD rip's embedded cue sheet and any application's own
// block were gone, and with the audio only copied through, the backup policy "only when
// the audio changes" kept no copy of them.
describe('a FLAC tag update', () => {
  it('keeps the cue sheet and application blocks it does not rewrite', async () => {
    const extra = [
      { type: APPLICATION, body: application('Srco', 40) },
      { type: CUESHEET, body: cueSheet() },
    ]
    const src = sourceWith('update.flac', extra)
    const audio = (p: string) => readFileSync(p).subarray(blocksOf(readFileSync(p)).audioAt)
    const audioBefore = audio(src)
    await convertAudio(src, src, 'flac', meta)

    expect(bodyOf(src, APPLICATION)).toEqual([extra[0].body])
    expect(bodyOf(src, CUESHEET)).toEqual([extra[1].body])
    expect(audio(src).equals(audioBefore)).toBe(true)
    expect((await readMeta(src)).tags.title).toBe('New Title')
  })

  it('keeps a block larger than the padding the encode left', async () => {
    const big = { type: APPLICATION, body: application('Big!', 40_000) }
    const src = sourceWith('big.flac', [big])
    await convertAudio(src, src, 'flac', meta)

    expect(bodyOf(src, APPLICATION)).toEqual([big.body])
    expect((await readMeta(src)).tags.title).toBe('New Title')
  })

  it('does not double a block on a second update', async () => {
    const src = sourceWith('twice.flac', [
      { type: APPLICATION, body: application('Srco', 40) },
      { type: CUESHEET, body: cueSheet() },
    ])
    await convertAudio(src, src, 'flac', meta)
    await convertAudio(src, src, 'flac', meta)

    expect(bodyOf(src, APPLICATION)).toHaveLength(1)
    expect(bodyOf(src, CUESHEET)).toHaveLength(1)
  })
})
