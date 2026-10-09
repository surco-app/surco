import { describe, expect, it, vi } from 'vitest'

const { liveCacheDir } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  return { liveCacheDir: mkdtempSync(join(tmpdir(), 'surco-musicbrainz-live-')) }
})
vi.mock('electron', () => ({ app: { getPath: () => liveCacheDir, on: () => {} } }))

import { preRankResults } from '../renderer/src/lib/release'
import { searchHintsFor } from '../renderer/src/lib/autoMatch'
import type { TrackItem } from '../renderer/src/types'
import { getRelease, matchesMbFormats, search } from './musicbrainz'
import { cleanHints } from './providers'

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

  // artexjay's report (08/10): with a Planet Earth track selected he typed the artist and
  // album by hand, with album-first off, and got other artists' songs called "Duran Duran".
  it('puts the deluxe edition first for an artist and album typed by hand', async () => {
    const typed = 'Duran Duran Duran Duran (Deluxe Edition)'
    const track = {
      query: 'Duran Duran Planet Earth',
      meta: { artist: 'Duran Duran', title: 'Planet Earth', album: 'Duran Duran (Deluxe Edition)' },
    } as TrackItem
    const hints = cleanHints(searchHintsFor(track, {}, typed), [], false)
    const rows = await search(typed, 'high', hints)
    const ranked = preRankResults(rows, { title: 'Planet Earth', artist: 'Duran Duran', typed })
    expect(ranked[0].title).toMatch(/^Duran Duran - Duran Duran \((deluxe|special edition)\)$/)
  }, 30_000)

  // The same text typed with a track of another artist selected travels as free text.
  it("finds the album for free text typed without the track's tags", async () => {
    const rows = await search('Duran Duran Duran Duran (Deluxe Edition)', 'high', {})
    expect(rows[0].title).toMatch(/^Duran Duran - Duran Duran \(/)
  }, 30_000)

  it('finds the tagged album first when album-first search hands over the album', async () => {
    const rows = await search('Kings Of Tomorrow - Finally', 'high', {
      artist: 'Kings Of Tomorrow',
      title: 'Finally',
      album: 'It’s in the Lifestyle',
    })
    expect(rows[0].title).toBe('Kings of Tomorrow - It’s in the Lifestyle')
  }, 30_000)

  // artexjay's vinyl-only search: unfiltered, "Finally" showed no vinyl among its first 28
  // releases (measured 01/10), so the filter has to reach the query, not just thin rows.
  it('finds vinyl pressings of Finally when only vinyl is wanted', async () => {
    const rows = await search(
      'Kings Of Tomorrow - Finally',
      'high',
      { artist: 'Kings Of Tomorrow', title: 'Finally' },
      ['Vinyl'],
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => matchesMbFormats(r, ['Vinyl']))).toBe(true)
  }, 30_000)
})
