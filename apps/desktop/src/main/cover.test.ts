import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const downloadCover = vi.fn()
const processCover = vi.fn()
const extractCoverFile = vi.fn()
const writeFile = vi.fn()
const unlink = vi.fn()

vi.mock('./coverDownload', () => ({ downloadCover: (url: string) => downloadCover(url) }))
vi.mock('./ffmpeg', () => ({
  processCover: (p: string, o: unknown) => processCover(p, o),
  extractCoverFile: (p: string) => extractCoverFile(p),
}))
vi.mock('node:fs/promises', () => ({
  writeFile: (p: string, b: unknown) => writeFile(p, b),
  unlink: (p: string) => unlink(p),
}))
vi.mock('./tmp', () => ({ tmpName: (prefix: string, ext: string) => `${prefix}.${ext}` }))

import { createCoverMemo, hasCoverSource, prepareProcessedCover } from './cover'

const opts = { maxSize: 1000, square: true, upscale: false }

beforeEach(() => {
  vi.clearAllMocks()
  downloadCover.mockResolvedValue('/tmp/downloaded.jpg')
  processCover.mockResolvedValue('/tmp/processed.jpg')
  writeFile.mockResolvedValue(undefined)
  unlink.mockResolvedValue(undefined)
})

// The IPC handlers gate cover preparation (and its progress stage) on this check.
// It must accept every origin prepareProcessedCover understands: when the two
// drifted apart, jobs whose art was the file's own embedded picture — named only
// by coverFromFile — converted and landed in Apple Music with no artwork at all.
describe('hasCoverSource', () => {
  it('counts a file whose own embedded art should be used', () => {
    expect(hasCoverSource({ coverFromFile: '/m/a.flac' })).toBe(true)
  })

  it('counts a user-picked file and a Discogs URL', () => {
    expect(hasCoverSource({ coverPath: '/cover.png' })).toBe(true)
    expect(hasCoverSource({ coverUrl: 'https://img/cover.jpg' })).toBe(true)
  })

  it('rejects a job naming no art at all', () => {
    expect(hasCoverSource({})).toBe(false)
  })
})

describe('prepareProcessedCover', () => {
  it('returns nothing when there is no cover to prepare', async () => {
    expect(await prepareProcessedCover({}, opts)).toBeUndefined()
    expect(processCover).not.toHaveBeenCalled()
  })

  // The renderer only keeps a display thumbnail of a file's own art, so anything that
  // writes art (embedding, export, drag) pulls the full-resolution picture fresh from
  // the source file instead of round-tripping the renderer's copy.
  it('extracts the source file’s own art at full resolution when asked', async () => {
    extractCoverFile.mockResolvedValue('/tmp/cover-full.jpg')
    const prepared = await prepareProcessedCover({ coverFromFile: '/m/a.flac' }, opts)
    expect(extractCoverFile).toHaveBeenCalledWith('/m/a.flac')
    expect(processCover).toHaveBeenCalledWith('/tmp/cover-full.jpg', opts)
    await prepared?.cleanup()
    expect(unlink).toHaveBeenCalledWith('/tmp/cover-full.jpg')
  })

  it('returns nothing when the source file carries no art to take', async () => {
    extractCoverFile.mockResolvedValue(null)
    expect(await prepareProcessedCover({ coverFromFile: '/m/a.flac' }, opts)).toBeUndefined()
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

  // A failed processing pass must not strand the file we just downloaded: cleanup is
  // only returned on success, so the temp has to be removed before the error propagates.
  it('removes the downloaded temp when processing fails', async () => {
    processCover.mockRejectedValue(new Error('ffmpeg blew up'))
    await expect(
      prepareProcessedCover({ coverUrl: 'https://img/cover.jpg' }, opts),
    ).rejects.toThrow('ffmpeg blew up')
    expect(unlink).toHaveBeenCalledWith('/tmp/downloaded.jpg')
  })

  it('decodes embedded art carried as a data URL before processing it', async () => {
    const prepared = await prepareProcessedCover({ coverUrl: 'data:image/jpeg;base64,QUJD' }, opts)
    expect(writeFile).toHaveBeenCalledTimes(1)
    const [, buffer] = writeFile.mock.calls[0]
    expect((buffer as Buffer).toString()).toBe('ABC')
    const embedPath = join(tmpdir(), 'embed.jpg')
    expect(processCover).toHaveBeenCalledWith(embedPath, opts)
    await prepared?.cleanup()
    expect(unlink).toHaveBeenCalledWith(embedPath)
  })
})

// A batch of Apple Music adds sharing one identical cover source + settings used to run
// processCover once per track; createCoverMemo shares the one in-flight/finished prepare
// across every caller keyed by the same (source, opts), refcounting cleanup so the file
// is only unlinked once every caller that received it has called its own cleanup().
describe('createCoverMemo', () => {
  const src = { coverPath: '/cover.png' }

  it('runs prepareProcessedCover once for two callers sharing the same source and opts', async () => {
    const memo = createCoverMemo(prepareProcessedCover)
    const [a, b] = await Promise.all([memo.prepare(src, opts), memo.prepare(src, opts)])
    expect(processCover).toHaveBeenCalledTimes(1)
    expect(a?.path).toBe('/tmp/processed.jpg')
    expect(b?.path).toBe('/tmp/processed.jpg')
  })

  it('unlinks the shared processed file only after every caller has cleaned up', async () => {
    const memo = createCoverMemo(prepareProcessedCover)
    const [a, b] = await Promise.all([memo.prepare(src, opts), memo.prepare(src, opts)])
    await a?.cleanup()
    expect(unlink).not.toHaveBeenCalled()
    await b?.cleanup()
    expect(unlink).toHaveBeenCalledWith('/tmp/processed.jpg')
  })

  it('runs a fresh prepare for a different cover source', async () => {
    processCover
      .mockResolvedValueOnce('/tmp/processed-a.jpg')
      .mockResolvedValueOnce('/tmp/processed-b.jpg')
    const memo = createCoverMemo(prepareProcessedCover)
    const [a, b] = await Promise.all([
      memo.prepare({ coverPath: '/cover-a.png' }, opts),
      memo.prepare({ coverPath: '/cover-b.png' }, opts),
    ])
    expect(processCover).toHaveBeenCalledTimes(2)
    expect(a?.path).toBe('/tmp/processed-a.jpg')
    expect(b?.path).toBe('/tmp/processed-b.jpg')
  })

  it('runs a fresh prepare for the same source with different cover settings', async () => {
    processCover
      .mockResolvedValueOnce('/tmp/processed-a.jpg')
      .mockResolvedValueOnce('/tmp/processed-b.jpg')
    const memo = createCoverMemo(prepareProcessedCover)
    const [a, b] = await Promise.all([
      memo.prepare(src, opts),
      memo.prepare(src, { ...opts, square: false }),
    ])
    expect(processCover).toHaveBeenCalledTimes(2)
    expect(a?.path).toBe('/tmp/processed-a.jpg')
    expect(b?.path).toBe('/tmp/processed-b.jpg')
  })

  it('starts a new prepare once every earlier caller for the same key has cleaned up', async () => {
    const memo = createCoverMemo(prepareProcessedCover)
    const first = await memo.prepare(src, opts)
    await first?.cleanup()
    processCover.mockResolvedValueOnce('/tmp/processed-2.jpg')
    const second = await memo.prepare(src, opts)
    expect(processCover).toHaveBeenCalledTimes(2)
    expect(second?.path).toBe('/tmp/processed-2.jpg')
  })

  it('propagates a prepare failure to every caller and does not pin it for later callers', async () => {
    processCover.mockRejectedValueOnce(new Error('ffmpeg blew up'))
    const memo = createCoverMemo(prepareProcessedCover)
    await expect(Promise.all([memo.prepare(src, opts), memo.prepare(src, opts)])).rejects.toThrow(
      'ffmpeg blew up',
    )
    processCover.mockResolvedValueOnce('/tmp/processed-retry.jpg')
    const retried = await memo.prepare(src, opts)
    expect(retried?.path).toBe('/tmp/processed-retry.jpg')
  })

  it('returns undefined for every caller when the job names no cover source', async () => {
    const memo = createCoverMemo(prepareProcessedCover)
    const [a, b] = await Promise.all([memo.prepare({}, opts), memo.prepare({}, opts)])
    expect(a).toBeUndefined()
    expect(b).toBeUndefined()
    expect(processCover).not.toHaveBeenCalled()
  })
})
