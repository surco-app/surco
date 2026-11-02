import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-artcopies-'))
  return { app: { getPath: () => dir } }
})

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { artworkCopyPath, forgetArtworkCopy } from './artworkCopies'

afterAll(() => rmSync(app.getPath('userData'), { recursive: true, force: true }))

// A cover fetched from Music is served from its copy from then on, so a cover Surco itself
// puts on the entry has to take the old copy with it, or the list keeps the old picture.
describe('artworkCopies', () => {
  it('keeps each entry’s copy in the artwork folder, by its persistent ID', () => {
    expect(artworkCopyPath('A1B2C3D4E5F60718')).toBe(
      join(app.getPath('userData'), 'applemusic-artwork', 'A1B2C3D4E5F60718.jpg'),
    )
  })

  it('forgets an entry’s copy', async () => {
    const copy = artworkCopyPath('A1B2C3D4E5F60718')
    mkdirSync(join(copy, '..'), { recursive: true })
    writeFileSync(copy, 'jpeg')

    await forgetArtworkCopy('A1B2C3D4E5F60718')

    expect(existsSync(copy)).toBe(false)
  })

  it('takes an entry with no copy in its stride', async () => {
    await expect(forgetArtworkCopy('0000000000000001')).resolves.toBeUndefined()
  })
})
