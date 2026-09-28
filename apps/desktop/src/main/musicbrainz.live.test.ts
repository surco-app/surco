import { describe, expect, it, vi } from 'vitest'

const { liveCacheDir } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  return { liveCacheDir: mkdtempSync(join(tmpdir(), 'surco-musicbrainz-live-')) }
})
vi.mock('electron', () => ({ app: { getPath: () => liveCacheDir, on: () => {} } }))

import { getRelease, search } from './musicbrainz'

const live = process.env.SURCO_MUSICBRAINZ_LIVE === '1'

describe.skipIf(!live)('MusicBrainz against the real API', () => {
  it('finds the original Finally single and loads its tracklist and cover', async () => {
    const rows = await search('Kings Of Tomorrow - Finally', 'high', {
      artist: 'Kings Of Tomorrow',
      title: 'Finally',
    })
    const hit = rows.find((r) => r.releaseUrl?.endsWith('4a27f230-ab38-4fae-8dd7-c5032fd4a4ee'))
    expect(hit).toBeDefined()
    const release = await getRelease(hit?.releaseUrl ?? '')
    expect(release.title).toBe('Finally (Includes Original & Kevin Yost Remixes)')
    expect(release.tracklist[0]).toMatchObject({ title: 'Finally', duration: '5:35' })
    expect(release.labels?.[0].name).toBe('Distance')
    const cover = release.images?.[0].uri ?? ''
    const res = await fetch(cover)
    expect(res.ok).toBe(true)
  }, 30_000)

  it('finds the tagged album first when album-first search hands over the album', async () => {
    const rows = await search('Kings Of Tomorrow - Finally', 'high', {
      artist: 'Kings Of Tomorrow',
      title: 'Finally',
      album: 'It’s in the Lifestyle',
    })
    expect(rows[0].title).toBe('Kings of Tomorrow - It’s in the Lifestyle')
  }, 30_000)
})
