import { copyFile, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tmpName } from './tmp'

// How many leading bytes to scan for a broken chunk. The malformed LIST lives among
// the RIFF chunks before the audio `data`, comfortably within 64 KB even when a JUNK
// pad chunk precedes it — so we never read the whole (often huge) file to find it.
const HEADER_SCAN_BYTES = 64 * 1024

// Byte offsets of every LIST chunk whose declared size is under 4 — the "too short
// LIST tag" ffmpeg's WAV demuxer aborts the whole file on (a LIST needs 4 bytes for
// its list-type id). Returns [] when buf is not a RIFF/WAVE header or carries no such
// chunk. Walks the RIFF chunk list (4-byte id, 4-byte little-endian size, body padded
// to even) up to the audio `data` chunk; a zero/odd size still advances ≥8 bytes so
// the walk can never stall.
export function malformedListOffsets(buf: Buffer): number[] {
  if (
    buf.length < 12 ||
    buf.toString('latin1', 0, 4) !== 'RIFF' ||
    buf.toString('latin1', 8, 12) !== 'WAVE'
  ) {
    return []
  }
  const offsets: number[] = []
  let pos = 12
  while (pos + 8 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4)
    if (id === 'data') break
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'LIST' && size < 4) offsets.push(pos)
    pos += 8 + size + (size & 1)
  }
  return offsets
}

// True when an ffmpeg/ffprobe failure is the demuxer rejecting malformed input — the
// only error a header repair could fix. Gates the repair so unrelated non-zero exits
// (no embedded picture, a broken filtergraph, a missing binary) never trigger a
// pointless copy of a healthy file.
export function isMalformedInputError(err: unknown): boolean {
  const stderr = String((err as { stderr?: unknown })?.stderr ?? '')
  return /Invalid data found|too short LIST tag/.test(stderr)
}

// Writes a repaired copy of a WAV whose RIFF header ffmpeg refuses, neutralizing each
// too-short LIST chunk by renaming its FourCC to JUNK — a JUNK chunk has no minimum
// size, so the same declared size now skips cleanly and every later byte (the audio
// itself) is unchanged. Returns the temp copy's path, or null when there is nothing
// to repair (a healthy file, a non-WAV, or an unreadable path), so the caller can fall
// back to surfacing the original error. The caller owns deleting the returned file.
export async function repairWav(input: string): Promise<string | null> {
  let src: Awaited<ReturnType<typeof open>> | undefined
  let offsets: number[]
  try {
    src = await open(input, 'r')
    const head = Buffer.alloc(HEADER_SCAN_BYTES)
    const { bytesRead } = await src.read(head, 0, HEADER_SCAN_BYTES, 0)
    offsets = malformedListOffsets(head.subarray(0, bytesRead))
  } catch {
    return null
  } finally {
    await src?.close()
  }
  if (offsets.length === 0) return null
  const tmp = join(tmpdir(), tmpName('wavfix', 'wav'))
  await copyFile(input, tmp)
  const fh = await open(tmp, 'r+')
  try {
    for (const off of offsets) await fh.write(Buffer.from('JUNK', 'latin1'), 0, 4, off)
  } finally {
    await fh.close()
  }
  return tmp
}
