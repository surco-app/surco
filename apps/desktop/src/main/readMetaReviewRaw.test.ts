import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { File as TagFile } from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))
const namespaces: string[] = []
vi.mock('./analysisCache', () => ({
  LOUDNESS_NAMESPACE: 'loudness',
  cachedAnalysis: (namespace: string, _input: string, run: () => Promise<unknown>) => {
    namespaces.push(namespace)
    return run()
  },
}))

import { readMeta } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-review-raw-'))

function encoded(name: string, codec: string[], tags: Record<string, string>): string {
  const file = join(dir, name)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    ...codec,
    ...Object.entries(tags).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]),
    file,
  ])
  return file
}

// The list review looks for spellings the rest of Surco trims away on read: a user's WAV
// carried its album as "Happiness " and the review, fed the trimmed read, never saw it.
describe('readMeta keeps the untrimmed review fields beside the trimmed tags', () => {
  it('keeps the trailing space an MP3 album carries while the tags stay trimmed', async () => {
    const file = encoded('bright.mp3', ['-c:a', 'libmp3lame'], {
      artist: 'Solaris',
      album: 'Bright Days ',
    })
    const read = await readMeta(file)
    expect(read.tags.album).toBe('Bright Days')
    expect(read.reviewRaw).toEqual({ album: 'Bright Days ' })
  })

  it('keeps the trailing space of a RIFF INFO album ffprobe reads', async () => {
    const file = encoded('tides.wav', ['-c:a', 'pcm_s16le'], { artist: 'Marea', album: 'Tides ' })
    const read = await readMeta(file)
    expect(read.tags.album).toBe('Tides')
    expect(read.reviewRaw?.album).toBe('Tides ')
  })

  it('keeps the trailing space of a field only TagLib reads, without the NUL INFO pads it with', async () => {
    const file = encoded('taglib.wav', ['-c:a', 'pcm_s16le'], {})
    const f = TagFile.createFromPath(file)
    try {
      f.tag.album = 'Tides '
      f.save()
    } finally {
      f.dispose()
    }
    const read = await readMeta(file)
    expect(read.tags.album).toBe('Tides')
    expect(read.reviewRaw?.album).toBe('Tides ')
  })

  it('carries nothing extra when every review field reads the same trimmed or not', async () => {
    const file = encoded('clean.mp3', ['-c:a', 'libmp3lame'], {
      artist: 'Solaris',
      title: 'Shine',
      album: 'Bright Days',
      genre: 'House',
    })
    expect((await readMeta(file)).reviewRaw).toBeUndefined()
  })

  it('reads under a new cache namespace, so a read cached trimmed is not served again', async () => {
    namespaces.length = 0
    await readMeta(encoded('ns.mp3', ['-c:a', 'libmp3lame'], { album: 'X' }))
    expect(namespaces).toEqual(['readmeta-v5'])
  })
})
