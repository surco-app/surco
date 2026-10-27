import { type FileHandle, open, readFile, writeFile } from 'node:fs/promises'

// ffmpeg writes a FLAC fresh: the stream info, its own Vorbis comment and padding. A
// same-format update therefore dropped a CD rip's embedded cue sheet and every
// application's own block, and because the audio is only copied through, no backup was
// kept of what was lost. Those two kinds are carried back from the source onto the
// finished file. The seek table is left to the encoder, and the comment and pictures are
// the tags the update rewrites on purpose.
const PADDING = 1
const APPLICATION = 2
const CUESHEET = 5
const CARRIED = new Set([APPLICATION, CUESHEET])

interface BlockAt {
  type: number
  offset: number
  size: number
}

// Where the "fLaC" marker sits: past an ID3v2 tag some taggers put in front of it.
async function flacStart(fh: FileHandle): Promise<number | null> {
  const head = Buffer.alloc(10)
  await fh.read(head, 0, 10, 0)
  let start = 0
  if (head.toString('latin1', 0, 3) === 'ID3') {
    const size =
      ((head[6] & 0x7f) << 21) |
      ((head[7] & 0x7f) << 14) |
      ((head[8] & 0x7f) << 7) |
      (head[9] & 0x7f)
    start = 10 + size + (head[5] & 0x10 ? 10 : 0)
    await fh.read(head, 0, 4, start)
  }
  return head.toString('latin1', 0, 4) === 'fLaC' ? start : null
}

async function metadataBlocks(fh: FileHandle): Promise<{ blocks: BlockAt[]; end: number } | null> {
  const start = await flacStart(fh)
  if (start === null) return null
  const { size: fileSize } = await fh.stat()
  const blocks: BlockAt[] = []
  const head = Buffer.alloc(4)
  for (let pos = start + 4; pos + 4 <= fileSize; ) {
    await fh.read(head, 0, 4, pos)
    const size = head.readUIntBE(1, 3)
    blocks.push({ type: head[0] & 0x7f, offset: pos, size })
    pos += 4 + size
    if (head[0] & 0x80) return { blocks, end: pos }
  }
  return null
}

async function bodyOf(fh: FileHandle, block: BlockAt): Promise<Buffer> {
  const body = Buffer.alloc(block.size)
  await fh.read(body, 0, block.size, block.offset + 4)
  return body
}

function header(blocks: { type: number; body: Buffer }[]): Buffer {
  return Buffer.concat(
    blocks.map(({ type, body }, i) => {
      const head = Buffer.alloc(4)
      head[0] = type | (i === blocks.length - 1 ? 0x80 : 0)
      head.writeUIntBE(body.length, 1, 3)
      return Buffer.concat([head, body])
    }),
  )
}

export async function carryFlacBlocks(source: string, dest: string): Promise<void> {
  const src = await open(source, 'r')
  const out = await open(dest, 'r+').catch(async (err) => {
    await src.close()
    throw err
  })
  try {
    const [from, have] = await Promise.all([metadataBlocks(src), metadataBlocks(out)])
    if (!from || !have) return
    const kept: { type: number; body: Buffer }[] = []
    for (const block of have.blocks)
      if (block.type !== PADDING) kept.push({ type: block.type, body: await bodyOf(out, block) })
    // An application block is identified by its four-byte id, so one the update already
    // wrote is not written twice. Only the output's ids count: a run of blocks sharing one
    // id in the source (flac --keep-foreign-metadata's "riff" header) is carried whole. A
    // FLAC holds at most one cue sheet, so only the first is taken.
    const ids = new Set(
      kept.map((b) =>
        b.type === APPLICATION ? `2/${b.body.toString('latin1', 0, 4)}` : `${b.type}`,
      ),
    )
    const carried: { type: number; body: Buffer }[] = []
    for (const block of from.blocks) {
      if (!CARRIED.has(block.type)) continue
      const body = await bodyOf(src, block)
      const id = block.type === APPLICATION ? `2/${body.toString('latin1', 0, 4)}` : `${block.type}`
      if (ids.has(id)) continue
      if (block.type === CUESHEET) ids.add(id)
      carried.push({ type: block.type, body })
    }
    if (carried.length === 0) return
    const blocks = [...kept, ...carried]
    const first = have.blocks[0].offset
    const room = have.end - first
    const used = blocks.reduce((sum, b) => sum + 4 + b.body.length, 0)
    // Into the padding when it has the room, so the audio is not moved at all; otherwise
    // the file is written again with the blocks and a fresh padding ahead of the audio.
    if (room - used >= 4) {
      const filled = header([...blocks, { type: PADDING, body: Buffer.alloc(room - used - 4) }])
      await out.write(filled, 0, filled.length, first)
      return
    }
    const file = await readFile(dest)
    const grown = header([...blocks, { type: PADDING, body: Buffer.alloc(8192) }])
    await writeFile(dest, Buffer.concat([file.subarray(0, first), grown, file.subarray(have.end)]))
  } finally {
    await out.close()
    await src.close()
  }
}
