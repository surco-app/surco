import { readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isMalformedInputError, malformedListOffsets, repairWav } from './wavRepair'

// Builds a RIFF/WAVE header. `listSize` drives the LIST chunk's declared size — 0
// reproduces the real-world corruption (a "too short LIST tag" ffmpeg aborts on),
// while a value ≥4 is a well-formed LIST. A JUNK pad chunk sits after LIST (as in
// the file that surfaced this) so the scan must walk past a healthy chunk too.
function wav(listSize: number): Buffer {
  const fmt = Buffer.concat([
    Buffer.from('fmt '),
    u32(16),
    Buffer.from([0x01, 0x00, 0x02, 0x00]),
    u32(44100),
    u32(176400),
    Buffer.from([0x04, 0x00, 0x10, 0x00]),
  ])
  const list = Buffer.concat([Buffer.from('LIST'), u32(listSize), Buffer.alloc(listSize)])
  const junk = Buffer.concat([Buffer.from('JUNK'), u32(8), Buffer.alloc(8)])
  const data = Buffer.concat([Buffer.from('data'), u32(4), Buffer.from([1, 2, 3, 4])])
  const body = Buffer.concat([Buffer.from('WAVE'), fmt, list, junk, data])
  return Buffer.concat([Buffer.from('RIFF'), u32(body.length), body])
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}

const tmpFiles: string[] = []
async function tmpFile(buf: Buffer): Promise<string> {
  const path = join(tmpdir(), `wavrepair-test-${tmpFiles.length}-${buf.length}.wav`)
  await writeFile(path, buf)
  tmpFiles.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(tmpFiles.splice(0).map((p) => unlink(p).catch(() => {})))
})

describe('malformedListOffsets', () => {
  it('finds the offset of a LIST chunk whose declared size is too short to be valid', () => {
    // ffmpeg rejects any LIST under 4 bytes (no room for the list-type id), so that
    // is the chunk a repair must neutralize — here it sits right after the 24-byte
    // fmt chunk: RIFF(12) + "fmt "+size+16 = 12 + 8 + 16 = 36.
    expect(malformedListOffsets(wav(0))).toEqual([36])
  })

  it('leaves a well-formed WAV untouched', () => {
    expect(malformedListOffsets(wav(8))).toEqual([])
  })

  it('ignores a buffer that is not a RIFF/WAVE header', () => {
    expect(malformedListOffsets(Buffer.from('not a wav at all here'))).toEqual([])
  })
})

describe('isMalformedInputError', () => {
  it('matches the demuxer rejecting malformed input', () => {
    expect(isMalformedInputError({ stderr: 'x: Invalid data found when processing input' })).toBe(
      true,
    )
    expect(isMalformedInputError({ stderr: '[wav @ 0x1] too short LIST tag' })).toBe(true)
  })

  it('ignores unrelated non-zero exits, so a healthy file is never copied', () => {
    expect(isMalformedInputError({ stderr: 'Stream map 0:v:0 matches no streams' })).toBe(false)
    expect(isMalformedInputError(new Error('spawn ENOENT'))).toBe(false)
  })
})

describe('repairWav', () => {
  it('renames a too-short LIST to JUNK so ffmpeg can read it, keeping every other byte', async () => {
    const original = wav(0)
    const src = await tmpFile(original)
    const out = await repairWav(src)
    expect(out).not.toBeNull()
    tmpFiles.push(out as string)
    const fixed = await readFile(out as string)
    // The four-byte FourCC at the LIST offset is now JUNK; the rest is identical, so
    // the audio data ffmpeg decodes is byte-for-byte the source.
    expect(fixed.toString('latin1', 36, 40)).toBe('JUNK')
    expect(fixed.subarray(0, 36)).toEqual(original.subarray(0, 36))
    expect(fixed.subarray(40)).toEqual(original.subarray(40))
  })

  it('returns null for a healthy WAV — nothing to repair', async () => {
    expect(await repairWav(await tmpFile(wav(8)))).toBeNull()
  })

  it('returns null for a path that does not exist', async () => {
    expect(await repairWav(join(tmpdir(), 'does-not-exist-surco.wav'))).toBeNull()
  })
})
