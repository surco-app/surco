import { beforeEach, describe, expect, it, vi } from 'vitest'

const counter = vi.hoisted(() => ({ now: 0, max: 0, order: [] as string[] }))

vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-source-stat-'))
  return { app: { getPath: () => dir }, nativeImage: {} }
})
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    stat: async (path: string) => {
      counter.order.push(path)
      counter.now++
      counter.max = Math.max(counter.max, counter.now)
      await new Promise((r) => setTimeout(r, 1))
      counter.now--
      return { isDirectory: () => false, size: 1, mtimeMs: 1 }
    },
  }
})

import { peekAnalysis } from './analysisCache'
import { expandPaths } from './expand'
import { loadLastSession, saveLastSession } from './session'

const paths = Array.from({ length: 40 }, (_, i) => `/Volumes/NAS/${i}.wav`)

beforeEach(() => {
  counter.max = 0
  counter.order = []
})

describe('stats of the tracks on disk', () => {
  it('keeps at most three in flight across the open, so a cover or a wave on the local disk is not queued behind a thousand network round trips', async () => {
    const [expanded, peeked] = await Promise.all([
      expandPaths(paths),
      Promise.all(paths.map((p) => peekAnalysis('spectrogram', p))),
    ])
    expect(expanded).toHaveLength(40)
    expect(peeked).toHaveLength(40)
    expect(counter.max).toBeLessThanOrEqual(3)
  })

  it('keeps the launch check of the last session to three as well, since it held the first playlist open for seven seconds', async () => {
    saveLastSession(paths, {})
    expect((await loadLastSession()).paths).toHaveLength(40)
    expect(counter.max).toBeLessThanOrEqual(3)
  })

  it('lets the tag read of the track being looked at past a whole playlist of queued stats, or opening All tracks left it reading for seconds', async () => {
    const opening = expandPaths(paths)
    const mine = '/Volumes/NAS/selected.wav'
    await peekAnalysis('readmeta-v5', mine, { urgent: true })
    await opening
    expect(counter.order.indexOf(mine)).toBeLessThanOrEqual(3)
    expect(counter.max).toBeLessThanOrEqual(3)
  })
})
