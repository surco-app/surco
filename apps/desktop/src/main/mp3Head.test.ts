import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { File as TagFile } from 'node-taglib-sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { leadingId3v2Size } from './id3Header'
import { absorbMp3HeadJunk } from './mp3Head'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-mp3head-'))
const clean = join(dir, 'clean.mp3')
let cleanBytes: Buffer
let tagSize: number

beforeAll(() => {
  execFileSync(FF, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-id3v2_version',
    '3',
    '-metadata',
    'title=Original',
    clean,
  ])
  cleanBytes = readFileSync(clean)
  tagSize = leadingId3v2Size(cleanBytes)
})

function tagLibTitle(file: string): string | undefined {
  const f = TagFile.createFromPath(file)
  try {
    return f.tag.title
  } finally {
    f.dispose()
  }
}

function decodable(file: string): boolean {
  try {
    execFileSync(FF, ['-hide_banner', '-v', 'error', '-xerror', '-i', file, '-f', 'null', '-'], {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function withJunkAfterTag(name: string, junk: Buffer): string {
  const file = join(dir, name)
  writeFileSync(
    file,
    Buffer.concat([cleanBytes.subarray(0, tagSize), junk, cleanBytes.subarray(tagSize)]),
  )
  return file
}

function withJunkAndNoTag(name: string, junk: Buffer): string {
  const file = join(dir, name)
  writeFileSync(file, Buffer.concat([junk, cleanBytes.subarray(tagSize)]))
  return file
}

describe('absorbMp3HeadJunk', () => {
  it('turns junk between the tag and the first frame into tag padding TagLib can read past', async () => {
    const file = withJunkAfterTag('junk-after-tag.mp3', Buffer.alloc(2000, 0xa5))
    expect(() => tagLibTitle(file)).toThrow(/MPEG audio header not found/)

    expect(await absorbMp3HeadJunk(file)).toBe(true)

    expect(tagLibTitle(file)).toBe('Original')
    expect(decodable(file)).toBe(true)
    const bytes = readFileSync(file)
    expect(bytes.length).toBe(cleanBytes.length + 2000)
    expect(bytes.subarray(leadingId3v2Size(bytes))).toEqual(cleanBytes.subarray(tagSize))
  })

  it('wraps the junk of a tagless file in a fresh empty tag', async () => {
    const file = withJunkAndNoTag('junk-no-tag.mp3', Buffer.alloc(3000, 0x20))
    expect(() => tagLibTitle(file)).toThrow(/MPEG audio header not found/)

    expect(await absorbMp3HeadJunk(file)).toBe(true)

    expect(tagLibTitle(file)).toBeUndefined()
    expect(decodable(file)).toBe(true)
    const bytes = readFileSync(file)
    expect(leadingId3v2Size(bytes)).toBe(3000)
    expect(bytes.subarray(3000)).toEqual(cleanBytes.subarray(tagSize))
  })

  it('leaves a file alone when the junk is still within reach of TagLib', async () => {
    const file = withJunkAfterTag('short-junk.mp3', Buffer.alloc(1020, 0xa5))
    const before = readFileSync(file)
    expect(tagLibTitle(file)).toBe('Original')

    expect(await absorbMp3HeadJunk(file)).toBe(false)

    expect(readFileSync(file)).toEqual(before)
  })

  it('leaves a clean file untouched', async () => {
    const file = join(dir, 'untouched.mp3')
    writeFileSync(file, cleanBytes)

    expect(await absorbMp3HeadJunk(file)).toBe(false)

    expect(readFileSync(file)).toEqual(cleanBytes)
  })

  it('never absorbs a second ID3 tag that follows the first', async () => {
    const secondTag = cleanBytes.subarray(0, tagSize)
    const file = withJunkAfterTag('two-tags.mp3', Buffer.concat([secondTag, Buffer.alloc(1500, 0)]))

    expect(await absorbMp3HeadJunk(file)).toBe(true)

    const bytes = readFileSync(file)
    expect(leadingId3v2Size(bytes)).toBe(tagSize)
    expect(bytes.subarray(tagSize, tagSize + 3).toString('latin1')).toBe('ID3')
    expect(tagLibTitle(file)).toBe('Original')
    expect(decodable(file)).toBe(true)
  })
})
