import { existsSync, readFileSync, rmSync } from 'node:fs'
import { readdir, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-cover-thumbs-'))
  return { app: { getPath: () => dir } }
})

import { app } from 'electron'
import { coverThumbPathOf, coverThumbUrlFor, pruneCoverThumbs } from './coverThumbs'

const jpeg = (fill: number): string =>
  `data:image/jpeg;base64,${Buffer.alloc(2000, fill).toString('base64')}`

const storeDir = (): string => join(app.getPath('userData'), 'cover-thumbs')

beforeEach(() => rmSync(storeDir(), { recursive: true, force: true }))
afterAll(() => rmSync(app.getPath('userData'), { recursive: true, force: true }))

// Every imported track held its embedded cover as a base64 data URL in the renderer's
// state, ~30 KB each and ~70 KB for the larger ones, for as long as it stayed in the list.
// The thumbnail now lives on disk and the track carries a short URL to it.
describe('coverThumbUrlFor', () => {
  it('hands back a short URL that resolves to the thumbnail bytes on disk', async () => {
    const url = await coverThumbUrlFor(jpeg(7))

    expect(url.length).toBeLessThan(80)
    const path = coverThumbPathOf(url)
    expect(path && readFileSync(path)).toEqual(Buffer.alloc(2000, 7))
  })

  // An album's tracks carry the same art, so they share one file and one URL. The URL
  // doubles as the identity the editor compares covers by, so equal art must give equal
  // strings, as the data URLs did.
  it('stores equal art once, under one URL', async () => {
    const a = await coverThumbUrlFor(jpeg(7))
    const b = await coverThumbUrlFor(jpeg(7))
    const other = await coverThumbUrlFor(jpeg(8))

    expect(a).toBe(b)
    expect(other).not.toBe(a)
    expect(await readdir(storeDir())).toHaveLength(2)
  })

  it('leaves anything that is not a data URL as it is', async () => {
    expect(await coverThumbUrlFor('https://i.discogs.com/x.jpg')).toBe(
      'https://i.discogs.com/x.jpg',
    )
  })
})

// The protocol serves whatever this resolves, so it must never reach outside the store.
describe('coverThumbPathOf', () => {
  it('refuses anything but a thumbnail id', () => {
    expect(coverThumbPathOf('surco://cover/..%2F..%2Fsettings.json')).toBeNull()
    expect(coverThumbPathOf('surco://media/%2Fetc%2Fpasswd')).toBeNull()
    expect(coverThumbPathOf('https://example.com/a.jpg')).toBeNull()
  })
})

describe('pruneCoverThumbs', () => {
  // Run at launch, before any track holds a URL, so pruning can never break an image on
  // screen; the next read of a pruned track's metadata stores its thumbnail again.
  it('deletes the oldest thumbnails until the store fits its budget', async () => {
    const old = coverThumbPathOf(await coverThumbUrlFor(jpeg(1))) as string
    const recent = coverThumbPathOf(await coverThumbUrlFor(jpeg(2))) as string
    const past = (Date.now() - 60_000) / 1000
    await utimes(old, past, past)

    await pruneCoverThumbs(2000)

    expect(existsSync(old)).toBe(false)
    expect(existsSync(recent)).toBe(true)
  })
})

describe('storing while the launch prune runs', () => {
  it('never deletes a thumbnail whose URL it has handed out', async () => {
    const old = coverThumbPathOf(await coverThumbUrlFor(jpeg(3))) as string
    const past = (Date.now() - 60_000) / 1000
    await utimes(old, past, past)

    const pruned = pruneCoverThumbs(0)
    const url = await coverThumbUrlFor(jpeg(3))
    await pruned

    expect(existsSync(coverThumbPathOf(url) as string)).toBe(true)
  })
})
