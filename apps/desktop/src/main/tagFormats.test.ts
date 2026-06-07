import { describe, expect, it } from 'vitest'
import { type Reader, detectTagFormats } from './tagFormats'

const readerOf =
  (buf: Buffer): Reader =>
  async (offset, length) =>
    buf.subarray(offset, offset + length)

const detect = (buf: Buffer) => detectTagFormats(readerOf(buf), buf.length)

// "ID3" + major version byte + revision + flags + 4 size bytes — the standalone
// header an MP3 carries, and the payload a WAV/AIFF id3 chunk wraps.
const id3v2 = (major: number) => Buffer.from([0x49, 0x44, 0x33, major, 0, 0, 0, 0, 0, 0])

function riffChunk(id: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.write(id, 0, 'latin1')
  header.writeUInt32LE(payload.length, 4)
  const pad = payload.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)
  return Buffer.concat([header, payload, pad])
}

function wav(...chunks: Buffer[]): Buffer {
  const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), ...chunks])
  const head = Buffer.alloc(8)
  head.write('RIFF', 0, 'latin1')
  head.writeUInt32LE(body.length, 4)
  return Buffer.concat([head, body])
}

function aiffChunk(id: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.write(id, 0, 'latin1')
  header.writeUInt32BE(payload.length, 4)
  const pad = payload.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)
  return Buffer.concat([header, payload, pad])
}

function aiff(...chunks: Buffer[]): Buffer {
  const body = Buffer.concat([Buffer.from('AIFF', 'latin1'), ...chunks])
  const head = Buffer.alloc(8)
  head.write('FORM', 0, 'latin1')
  head.writeUInt32BE(body.length, 4)
  return Buffer.concat([head, body])
}

function flacBlock(type: number, last: boolean, data: Buffer): Buffer {
  const header = Buffer.alloc(4)
  header[0] = (last ? 0x80 : 0) | (type & 0x7f)
  header.writeUIntBE(data.length, 1, 3)
  return Buffer.concat([header, data])
}

describe('detectTagFormats', () => {
  it('reads the version off a standalone ID3v2 header', async () => {
    expect(await detect(id3v2(3))).toEqual(['ID3v2.3'])
    expect(await detect(id3v2(4))).toEqual(['ID3v2.4'])
  })

  it('finds an ID3v1 trailer on a non-container (MP3) file', async () => {
    const buf = Buffer.alloc(300)
    buf.write('\xff\xfb', 0, 'latin1') // an MP3 frame sync, not a container magic
    buf.write('TAG', buf.length - 128, 'latin1')
    expect(await detect(buf)).toEqual(['ID3v1'])
  })

  it('lists both tag blocks a tagged MP3 carries, ID3v2 first', async () => {
    const buf = Buffer.alloc(300)
    id3v2(4).copy(buf, 0)
    buf.write('TAG', buf.length - 128, 'latin1')
    expect(await detect(buf)).toEqual(['ID3v2.4', 'ID3v1'])
  })

  it('walks WAV chunks for a RIFF INFO list and an embedded id3 chunk', async () => {
    // The id3 chunk sits AFTER a (here small, in the wild huge) data chunk, which the
    // walker must skip by size without reading its payload.
    const file = wav(
      riffChunk('fmt ', Buffer.alloc(16)),
      riffChunk('data', Buffer.alloc(40)),
      riffChunk('LIST', Buffer.concat([Buffer.from('INFO'), riffChunk('INAM', Buffer.from('Song\0'))])),
      riffChunk('id3 ', id3v2(3)),
    )
    expect(await detect(file)).toEqual(['ID3v2.3', 'INFO'])
  })

  it('does not mistake WAV audio for an ID3v1 trailer', async () => {
    // ID3v1 is an MP3-only convention; a RIFF container must not get a phantom tag
    // just because its last 128 bytes happen to start with "TAG".
    const file = wav(riffChunk('data', Buffer.concat([Buffer.from('TAG'), Buffer.alloc(200)])))
    expect(await detect(file)).toEqual([])
  })

  it('finds an ID3 chunk inside an AIFF container', async () => {
    const file = aiff(aiffChunk('SSND', Buffer.alloc(20)), aiffChunk('ID3 ', id3v2(3)))
    expect(await detect(file)).toEqual(['ID3v2.3'])
  })

  it('flags a FLAC Vorbis comment block', async () => {
    const file = Buffer.concat([
      Buffer.from('fLaC'),
      flacBlock(0, false, Buffer.alloc(34)), // STREAMINFO
      flacBlock(4, true, Buffer.from('vendor')), // VORBIS_COMMENT, last block
    ])
    expect(await detect(file)).toEqual(['Vorbis comment'])
  })

  it('returns nothing for an untagged or unrecognized file', async () => {
    expect(await detect(Buffer.from('not audio at all'))).toEqual([])
  })
})
