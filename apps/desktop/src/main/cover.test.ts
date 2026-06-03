import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const downloadCover = vi.fn()
const processCover = vi.fn()
const writeFile = vi.fn()
const unlink = vi.fn()

vi.mock('./discogs', () => ({ downloadCover: (url: string) => downloadCover(url) }))
vi.mock('./ffmpeg', () => ({ processCover: (p: string, o: unknown) => processCover(p, o) }))
vi.mock('node:fs/promises', () => ({
  writeFile: (p: string, b: unknown) => writeFile(p, b),
  unlink: (p: string) => unlink(p),
}))
vi.mock('./tmp', () => ({ tmpName: (prefix: string, ext: string) => `${prefix}.${ext}` }))

import { prepareProcessedCover } from './cover'

const opts = { maxSize: 1000, square: true }

beforeEach(() => {
  vi.clearAllMocks()
  downloadCover.mockResolvedValue('/tmp/downloaded.jpg')
  processCover.mockResolvedValue('/tmp/processed.jpg')
  writeFile.mockResolvedValue(undefined)
  unlink.mockResolvedValue(undefined)
})

describe('prepareProcessedCover', () => {
  it('returns nothing when there is no cover to prepare', async () => {
    expect(await prepareProcessedCover({}, opts)).toBeUndefined()
    expect(processCover).not.toHaveBeenCalled()
  })

  it('processes a local file directly without downloading or decoding', async () => {
    const prepared = await prepareProcessedCover({ coverPath: '/cover.png' }, opts)
    expect(downloadCover).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expect(processCover).toHaveBeenCalledWith('/cover.png', opts)
    expect(prepared?.path).toBe('/tmp/processed.jpg')
  })

  it('cleaning up a local file removes only the processed temp, never the original', async () => {
    const prepared = await prepareProcessedCover({ coverPath: '/cover.png' }, opts)
    await prepared?.cleanup()
    expect(unlink).toHaveBeenCalledWith('/tmp/processed.jpg')
    expect(unlink).not.toHaveBeenCalledWith('/cover.png')
  })

  it('downloads a Discogs http cover before processing it', async () => {
    const prepared = await prepareProcessedCover({ coverUrl: 'https://img/cover.jpg' }, opts)
    expect(downloadCover).toHaveBeenCalledWith('https://img/cover.jpg')
    expect(processCover).toHaveBeenCalledWith('/tmp/downloaded.jpg', opts)
    await prepared?.cleanup()
    expect(unlink).toHaveBeenCalledWith('/tmp/downloaded.jpg')
    expect(unlink).toHaveBeenCalledWith('/tmp/processed.jpg')
  })

  it('decodes embedded art carried as a data URL before processing it', async () => {
    const prepared = await prepareProcessedCover(
      { coverUrl: 'data:image/jpeg;base64,QUJD' },
      opts,
    )
    expect(writeFile).toHaveBeenCalledTimes(1)
    const [, buffer] = writeFile.mock.calls[0]
    expect((buffer as Buffer).toString()).toBe('ABC')
    const embedPath = join(tmpdir(), 'embed.jpg')
    expect(processCover).toHaveBeenCalledWith(embedPath, opts)
    await prepared?.cleanup()
    expect(unlink).toHaveBeenCalledWith(embedPath)
  })
})
