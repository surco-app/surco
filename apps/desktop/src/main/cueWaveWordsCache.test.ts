import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-cue-words-cache-'))
  return { app: { getPath: () => dir } }
})

const measureCueWaveWords = vi.hoisted(() =>
  vi.fn<(input: string) => Promise<Uint16Array | null>>(),
)
vi.mock('./ffmpeg', () => ({ measureCueWaveWords }))

import { cachedCueWaveWords } from './cueWaveWordsCache'

function track(): string {
  const file = join(mkdtempSync(join(tmpdir(), 'surco-cue-words-src-')), 'a.aiff')
  writeFileSync(file, 'audio')
  return file
}

describe('cachedCueWaveWords', () => {
  it('decodes a track once and serves the same words afterwards, so a second Auto marcar on many tracks is quick', async () => {
    const file = track()
    measureCueWaveWords.mockReset().mockResolvedValue(new Uint16Array([4, 8, 65535]))
    expect(await cachedCueWaveWords(file)).toEqual(new Uint16Array([4, 8, 65535]))
    expect(await cachedCueWaveWords(file)).toEqual(new Uint16Array([4, 8, 65535]))
    expect(measureCueWaveWords).toHaveBeenCalledTimes(1)
  })

  it('tries again next time when a track could not be read, since the volume may only have been away', async () => {
    const file = track()
    measureCueWaveWords
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(new Uint16Array([4]))
    expect(await cachedCueWaveWords(file)).toBeNull()
    expect(await cachedCueWaveWords(file)).toEqual(new Uint16Array([4]))
  })
})
