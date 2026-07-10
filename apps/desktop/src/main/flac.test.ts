import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { flacHasUnreadablePicture } from './flac'

// Builds a FLAC metadata block: a 4-byte header (last-block flag + 7-bit type,
// then a 24-bit big-endian body length) followed by the body.
function block(type: number, body: Buffer, last: boolean): Buffer {
  const header = Buffer.alloc(4)
  header[0] = (last ? 0x80 : 0) | (type & 0x7f)
  header.writeUIntBE(body.length, 1, 3)
  return Buffer.concat([header, body])
}

// A PICTURE block (type 6) body. `mime` empty reproduces the malformed art some
// taggers emit (a zero-length MIME string), which is exactly what trips Chromium.
function pictureBody(mime: string): Buffer {
  const parts: Buffer[] = []
  parts.push(u32(3)) // picture type: front cover
  parts.push(u32(mime.length))
  parts.push(Buffer.from(mime, 'latin1'))
  parts.push(u32(0)) // description length
  parts.push(u32(0), u32(0), u32(0), u32(0)) // width, height, depth, colors
  const data = Buffer.from([0xff, 0xd8, 0xff, 0xd9]) // tiny stand-in JPEG
  parts.push(u32(data.length))
  parts.push(data)
  return Buffer.concat(parts)
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

const STREAMINFO = block(0, Buffer.alloc(34), false)

let dir: string
const paths: string[] = []
async function flacFile(name: string, ...blocks: Buffer[]): Promise<string> {
  const p = join(dir, name)
  await writeFile(p, Buffer.concat([Buffer.from('fLaC', 'latin1'), ...blocks]))
  paths.push(p)
  return p
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flac-test-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('flacHasUnreadablePicture', () => {
  it('flags a PICTURE block with an empty MIME type, since Chromium cannot decode it and then refuses the whole file', async () => {
    const p = await flacFile('empty-mime.flac', STREAMINFO, block(6, pictureBody(''), true))
    expect(await flacHasUnreadablePicture(p)).toBe(true)
  })

  it('leaves a picture with a real MIME type alone, so valid embedded art still plays', async () => {
    const p = await flacFile(
      'good-mime.flac',
      STREAMINFO,
      block(6, pictureBody('image/jpeg'), true),
    )
    expect(await flacHasUnreadablePicture(p)).toBe(false)
  })

  it('returns false when the file carries no embedded picture', async () => {
    const p = await flacFile('no-picture.flac', block(0, Buffer.alloc(34), true))
    expect(await flacHasUnreadablePicture(p)).toBe(false)
  })

  it('returns false for a file that is not FLAC at all, rather than misreading its bytes', async () => {
    const p = join(dir, 'not.flac')
    await writeFile(p, Buffer.from('ID3\x04not a flac', 'latin1'))
    paths.push(p)
    expect(await flacHasUnreadablePicture(p)).toBe(false)
  })

  it('still flags the empty MIME behind the ID3v2 header a Finder-covers FLAC starts with', async () => {
    // "ID3", v2.3, no flags, syncsafe size 0 — a minimal 10-byte header like the one
    // Surco prepends so Finder shows the art; the real FLAC stream starts after it.
    const id3 = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0])
    const p = join(dir, 'id3-empty-mime.flac')
    await writeFile(
      p,
      Buffer.concat([
        id3,
        Buffer.from('fLaC', 'latin1'),
        STREAMINFO,
        block(6, pictureBody(''), true),
      ]),
    )
    paths.push(p)
    expect(await flacHasUnreadablePicture(p)).toBe(true)
  })
})
