import { type FileHandle, open } from 'node:fs/promises'

// ffmpeg writes a WAV fresh: the format, its own INFO tags and the audio. A same-format
// update therefore dropped every other chunk the source carried (markers and loops in
// cue/smpl with their LIST adtl labels, a Broadcast WAV bext, iXML, acid tempo info),
// and because the audio is only copied through, no backup was kept of what was lost.
// These are carried back from the source onto the finished file.
//
// Left out are the chunks the conversion itself writes on purpose (format, audio, the
// INFO list and the ID3 chunk holding the tags just edited), and padding.
const REWRITTEN = new Set([
  'fmt ',
  'data',
  'fact',
  'ds64',
  'id3 ',
  'ID3 ',
  'JUNK',
  'junk',
  'PAD ',
  'FLLR',
])

interface ChunkAt {
  key: string
  offset: number
  size: number
}

async function riffChunks(fh: FileHandle): Promise<ChunkAt[] | null> {
  const { size: fileSize } = await fh.stat()
  const head = Buffer.alloc(12)
  await fh.read(head, 0, 12, 0)
  if (head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE')
    return null
  const chunks: ChunkAt[] = []
  const header = Buffer.alloc(12)
  for (let pos = 12; pos + 8 <= fileSize; ) {
    await fh.read(header, 0, 12, pos)
    const id = header.toString('latin1', 0, 4)
    const size = header.readUInt32LE(4)
    if (pos + 8 + size > fileSize) break
    const key = id === 'LIST' && size >= 4 ? `LIST/${header.toString('latin1', 8, 12)}` : id
    chunks.push({ key, offset: pos, size })
    pos += 8 + size + (size & 1)
  }
  return chunks
}

export async function carryRiffChunks(source: string, dest: string): Promise<void> {
  const src = await open(source, 'r')
  try {
    const out = await open(dest, 'r+')
    try {
      const [from, have] = await Promise.all([riffChunks(src), riffChunks(out)])
      if (!from || !have) return
      const present = new Set(have.map((c) => c.key))
      const carried = from.filter(
        (c) => !REWRITTEN.has(c.key) && c.key !== 'LIST/INFO' && !present.has(c.key),
      )
      if (carried.length === 0) return
      let end = (await out.stat()).size
      const total = carried.reduce((sum, c) => sum + 8 + c.size + (c.size & 1), end + (end & 1))
      // A RIFF size past 4 GB does not fit the header (that is RF64), so the update fails
      // rather than quietly drop the chunks again.
      if (total - 8 > 0xffffffff) throw new Error(`WAV too large to keep its chunks: ${dest}`)
      if (end & 1) {
        await out.write(Buffer.alloc(1), 0, 1, end)
        end += 1
      }
      for (const chunk of carried) {
        const padded = 8 + chunk.size + (chunk.size & 1)
        const bytes = Buffer.alloc(padded)
        await src.read(bytes, 0, 8 + chunk.size, chunk.offset)
        await out.write(bytes, 0, padded, end)
        end += padded
      }
      const size = Buffer.alloc(4)
      size.writeUInt32LE(end - 8, 0)
      await out.write(size, 0, 4, 4)
    } finally {
      await out.close()
    }
  } finally {
    await src.close()
  }
}
