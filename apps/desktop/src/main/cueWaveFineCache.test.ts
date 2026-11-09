import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-cue-fine-cache-'))
  return { app: { getPath: () => dir } }
})

const measureCueWaveFine = vi.hoisted(() => vi.fn<(input: string) => Promise<Uint8Array | null>>())
vi.mock('./ffmpeg', () => ({ measureCueWaveFine }))

import { cachedCueWaveFine } from './cueWaveFineCache'

function track(): string {
  const file = join(mkdtempSync(join(tmpdir(), 'surco-cue-fine-src-')), 'a.aiff')
  writeFileSync(file, 'audio')
  return file
}

describe('cachedCueWaveFine', () => {
  it('decodes a track once and keeps every level byte for byte, so reopening the editor zooms at once', async () => {
    const file = track()
    measureCueWaveFine.mockReset().mockResolvedValue(new Uint8Array([4, 8, 255]))
    expect(await cachedCueWaveFine(file)).toEqual(new Uint8Array([4, 8, 255]))
    expect(await cachedCueWaveFine(file)).toEqual(new Uint8Array([4, 8, 255]))
    expect(measureCueWaveFine).toHaveBeenCalledTimes(1)
  })

  it('tries again next time when a track could not be read, since the volume may only have been away', async () => {
    const file = track()
    measureCueWaveFine
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(new Uint8Array([4]))
    expect(await cachedCueWaveFine(file)).toBeNull()
    expect(await cachedCueWaveFine(file)).toEqual(new Uint8Array([4]))
  })
})
