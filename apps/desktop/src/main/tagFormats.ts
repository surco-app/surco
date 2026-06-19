import { open } from 'node:fs/promises'

// A minimal random-access reader over a file region — the seam that lets the chunk
// walking below run against an in-memory Buffer in tests and a real file handle in
// production, without either knowing about the other.
export type Reader = (offset: number, length: number) => Promise<Buffer>

const ascii = (buf: Buffer, start: number, end: number): string =>
  buf.toString('latin1', start, end)

// Names a metadata container by sniffing the file's structure, since ffprobe reports
// the tags' values but never which envelope they came from (ID3v2.3 vs an INFO list,
// etc.). Best-effort: it walks chunk/block headers only — never tag payloads — and
// returns whatever it can identify, in a stable display order. Unknown shapes yield [].
export async function detectTagFormats(read: Reader, size: number): Promise<string[]> {
  const found = new Set<string>()
  const head = await read(0, Math.min(size, 12))
  const magic = head.length >= 4 ? ascii(head, 0, 4) : ''

  // A standalone ID3v2 header (MP3) starts with "ID3" + a major-version byte.
  if (head.length >= 4 && ascii(head, 0, 3) === 'ID3') found.add(`ID3v2.${head[3]}`)

  let container = false
  if (magic === 'RIFF' && head.length >= 12 && ascii(head, 8, 12) === 'WAVE') {
    container = true
    await walkRiff(read, size, found, 'le')
  } else if (
    magic === 'FORM' &&
    head.length >= 12 &&
    (ascii(head, 8, 12) === 'AIFF' || ascii(head, 8, 12) === 'AIFC')
  ) {
    container = true
    await walkRiff(read, size, found, 'be')
  } else if (magic === 'fLaC') {
    container = true
    await walkFlac(read, size, found)
  }

  // ID3v1 lives in the last 128 bytes, but only as an MP3 convention — checking it on
  // a RIFF/AIFF/FLAC container would invent a tag from coincidental "TAG" audio bytes.
  if (!container && size >= 128) {
    const tail = await read(size - 128, 128)
    if (tail.length >= 3 && ascii(tail, 0, 3) === 'TAG') found.add('ID3v1')
  }

  return orderFormats(found)
}

// Walks top-level RIFF (WAV, little-endian sizes) or IFF (AIFF, big-endian) chunks,
// reading just each 8-byte header and skipping payloads by size — so a multi-megabyte
// data chunk costs nothing and trailing metadata chunks are still reached.
async function walkRiff(
  read: Reader,
  size: number,
  found: Set<string>,
  endian: 'le' | 'be',
): Promise<void> {
  let offset = 12
  for (let guard = 0; offset + 8 <= size && guard < 256; guard++) {
    const header = await read(offset, 8)
    if (header.length < 8) break
    const id = ascii(header, 0, 4)
    const chunkSize = endian === 'le' ? header.readUInt32LE(4) : header.readUInt32BE(4)
    const payload = offset + 8
    if (id === 'LIST') {
      const type = await read(payload, 4)
      if (type.length >= 4 && ascii(type, 0, 4) === 'INFO') found.add('INFO')
    } else if (id === 'id3 ' || id === 'ID3 ') {
      const p = await read(payload, 4)
      if (p.length >= 4 && ascii(p, 0, 3) === 'ID3') found.add(`ID3v2.${p[3]}`)
    }
    // Chunks are padded to an even byte boundary.
    offset = payload + chunkSize + (chunkSize % 2)
  }
}

// Walks FLAC's metadata block headers (4 bytes each: a flag/type byte then a 24-bit
// big-endian length) until the last-block flag, looking for a VORBIS_COMMENT (type 4).
async function walkFlac(read: Reader, size: number, found: Set<string>): Promise<void> {
  let offset = 4
  for (let guard = 0; offset + 4 <= size && guard < 128; guard++) {
    const header = await read(offset, 4)
    if (header.length < 4) break
    const last = (header[0] & 0x80) !== 0
    const type = header[0] & 0x7f
    const length = (header[1] << 16) | (header[2] << 8) | header[3]
    if (type === 4) found.add('Vorbis comment')
    offset += 4 + length
    if (last) break
  }
}

function orderFormats(found: Set<string>): string[] {
  const rank = (f: string): number => {
    if (f.startsWith('ID3v2')) return 0
    if (f === 'ID3v1') return 1
    if (f === 'INFO') return 2
    if (f === 'Vorbis comment') return 3
    return 4
  }
  return [...found].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

export async function readTagFormats(input: string): Promise<string[]> {
  const handle = await open(input, 'r')
  try {
    const { size } = await handle.stat()
    const read: Reader = async (offset, length) => {
      const buf = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buf, 0, length, offset)
      return buf.subarray(0, bytesRead)
    }
    return await detectTagFormats(read, size)
  } finally {
    await handle.close()
  }
}
