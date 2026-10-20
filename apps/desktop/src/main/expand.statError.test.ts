import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { sourceStat } from './sourceStat'

const statMock = vi.hoisted(() => vi.fn<typeof sourceStat>())

vi.mock('./sourceStat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sourceStat')>()),
  sourceStat: statMock,
}))

import { expandPaths } from './expand'

function fsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

const track = '/Volumes/Public/Music/Beny Junior - Tengo (Orginal Mix).aiff'

beforeEach(() => {
  statMock.mockReset()
})

describe('expandPaths when the stat of a track fails', () => {
  it.each(['ETIMEDOUT', 'EIO', 'EHOSTDOWN', 'ENOTCONN', 'EAGAIN', 'EBUSY', 'EINTR'])(
    'keeps a file whose stat failed with %s, since a busy machine or a slow share does not mean the file is gone and the playlist opened empty with every track called missing',
    async (code) => {
      statMock.mockRejectedValue(fsError(code))
      expect(await expandPaths([track])).toEqual([track])
    },
  )

  it('announces a kept file like any other, so a streaming caller shows its row too', async () => {
    statMock.mockRejectedValue(fsError('ETIMEDOUT'))
    const onBatch = vi.fn<(paths: string[]) => void>()
    await expandPaths([track], onBatch)
    expect(onBatch).toHaveBeenCalledWith([track])
  })

  it.each(['ENOENT', 'ENOTDIR'])(
    'drops a path whose stat says %s on a disk that is there, the only answers that mean there is no file',
    async (code) => {
      const gone = join(tmpdir(), 'surco-never-there', 'Tengo.aiff')
      statMock.mockRejectedValue(fsError(code))
      expect(await expandPaths([gone])).toEqual([])
    },
  )

  it('keeps a file whose stat says ENOENT while its network volume is not mounted, since the share drops for a minute on a network change and the playlist opened empty with every track called missing', async () => {
    const unmounted = '/Volumes/surco-unmounted-share/Music/Tengo.aiff'
    statMock.mockRejectedValue(fsError('ENOENT'))
    expect(await expandPaths([unmounted])).toEqual([unmounted])
  })
})
