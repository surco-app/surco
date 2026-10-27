import { beforeEach, describe, expect, it, vi } from 'vitest'

// NTFS file ids are 64-bit. Two neighbours in the same folder can get ids that differ
// only past 2^53, where a JavaScript number can no longer tell them apart: a plain
// stat() hands back both as the same rounded number. Read as the same file, the
// neighbour is overwritten with no conflict prompt and no backup. These ids are what
// a bigint stat returns for two such files, and what the lossy number form rounds them to.
const SONG = 2n ** 60n + 1n
const NEIGHBOUR = 2n ** 60n + 2n

const fs = vi.hoisted(() => ({ unlinked: [] as string[] }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const ids: Record<string, bigint> = { '/music/song.wav': SONG, '/music/neighbour.wav': NEIGHBOUR }
  return {
    ...actual,
    stat: async (path: string, opts?: { bigint?: boolean }) => {
      const ino = ids[path]
      if (ino === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return opts?.bigint ? { ino, dev: 7n } : { ino: Number(ino), dev: 7 }
    },
    unlink: async (path: string) => {
      fs.unlinked.push(path)
    },
  }
})

const { isSameFile, removeRenamedOriginal } = await import('./inplace')

beforeEach(() => {
  fs.unlinked.length = 0
})

describe('file identity past 2^53', () => {
  it('tells apart two files whose 64-bit ids round to the same number', async () => {
    expect(Number(SONG)).toBe(Number(NEIGHBOUR))
    expect(await isSameFile('/music/song.wav', '/music/neighbour.wav')).toBe(false)
  })

  it('drops the renamed-away original instead of mistaking it for the new file', async () => {
    await removeRenamedOriginal('/music/song.wav', '/music/neighbour.wav')
    expect(fs.unlinked).toEqual(['/music/song.wav'])
  })
})
