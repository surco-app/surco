import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-music-art-timeout-'))
  return { app: { getPath: () => dir } }
})

import { app } from 'electron'
import { fetchAppleMusicArtwork } from './appleMusicArtwork'

const bin = mkdtempSync(join(tmpdir(), 'surco-fake-osascript-'))
const originalPath = process.env.PATH

beforeAll(() => {
  const fake = join(bin, 'osascript')
  writeFileSync(fake, '#!/bin/sh\nexec sleep 30\n')
  chmodSync(fake, 0o755)
  process.env.PATH = `${bin}:${originalPath}`
})

afterAll(() => {
  process.env.PATH = originalPath
  rmSync(bin, { recursive: true, force: true })
  rmSync(app.getPath('userData'), { recursive: true, force: true })
})

describe('fetchAppleMusicArtwork', () => {
  it.skipIf(process.platform === 'win32')(
    'gives up on a Music that never answers, because the artwork fetch holds the queue every other Music read waits behind',
    async () => {
      const started = Date.now()
      await expect(
        fetchAppleMusicArtwork([{ persistentId: 'PID1', outPath: join(bin, 'PID1.jpg') }], 300),
      ).rejects.toThrow()
      expect(Date.now() - started).toBeLessThan(3000)
    },
  )
})
