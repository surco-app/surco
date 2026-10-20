import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { sourceStat } from './sourceStat'

const statMock = vi.hoisted(() => vi.fn<typeof sourceStat>())

vi.mock('./sourceStat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sourceStat')>()),
  sourceStat: statMock,
}))
vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-session-stat-'))
  return { app: { getPath: () => dir }, nativeImage: {} }
})

import { rmSync } from 'node:fs'
import { app } from 'electron'
import { loadLastSession, saveLastSession } from './session'

function fsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

const track = '/Volumes/Public/Music/Beny Junior - Tengo (Orginal Mix).aiff'

afterAll(() => rmSync(app.getPath('userData'), { recursive: true, force: true }))

beforeEach(() => {
  statMock.mockReset()
})

describe('last session when the stat of a track fails', () => {
  it.each(['ETIMEDOUT', 'EIO', 'EHOSTDOWN', 'ENOTCONN', 'EAGAIN', 'EBUSY', 'EINTR'])(
    'keeps a track whose stat failed with %s, since a slow share at launch does not mean the file is gone and the reopen offer lost it for good',
    async (code) => {
      statMock.mockRejectedValue(fsError(code))
      saveLastSession([track], {})
      expect((await loadLastSession()).paths).toEqual([track])
    },
  )

  it.each(['ENOENT', 'ENOTDIR'])(
    'drops a track whose stat says %s, the only answers that mean there is no file there',
    async (code) => {
      statMock.mockRejectedValue(fsError(code))
      saveLastSession([track], {})
      expect((await loadLastSession()).paths).toEqual([])
    },
  )
})
