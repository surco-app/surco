import { describe, expect, it, vi } from 'vitest'
import { attachMissingArtwork } from './appleMusicPlaylistArt'

// Importing a playlist left half the rows with an empty cover slot: the files carry no
// picture (53% of the real library, almost all WAVs) while Music holds the artwork for the
// very same track. This is what closes that gap, and it only fetches for the files that
// need it.

const tracks = {
  paths: ['/m/one.wav', '/m/two.mp3'],
  persistentIds: { '/m/one.wav': 'PID1', '/m/two.mp3': 'PID2' },
  meta: { '/m/one.wav': { year: '1995' }, '/m/two.mp3': {} },
  missing: 0,
}

function deps(over: Partial<Parameters<typeof attachMissingArtwork>[1]> = {}) {
  return {
    hasEmbedded: vi.fn(async (p: string) => p.endsWith('.mp3')),
    fetchArtwork: vi.fn(async (jobs: { persistentId: string; outPath: string }[]) =>
      jobs.map((j) => ({ path: j.outPath, url: `data:image/jpeg;base64,${j.persistentId}` })),
    ),
    outDir: async () => '/tmp/art',
    ...over,
  }
}

describe('attachMissingArtwork', () => {
  it('gives the cover to the track whose file carries none', async () => {
    const out = await attachMissingArtwork(tracks, deps())

    expect(out.meta['/m/one.wav'].coverPath).toBe('/tmp/art/PID1.jpg')
    // Both halves: the path is what a conversion embeds, the data URL is the only thing
    // the sandboxed renderer can actually show — it cannot load a file:// image, so a
    // path alone would leave the very empty slot this fixes.
    expect(out.meta['/m/one.wav'].coverUrl).toBe('data:image/jpeg;base64,PID1')
    // The MP3 already carries its own full-resolution picture; fetching a second one would
    // be work for nothing, and the file's own art is what should win.
    expect(out.meta['/m/two.mp3'].coverPath).toBeUndefined()
  })

  it('keeps everything else the import already resolved', async () => {
    const out = await attachMissingArtwork(tracks, deps())

    expect(out.paths).toEqual(tracks.paths)
    expect(out.meta['/m/one.wav'].year).toBe('1995')
    expect(out.missing).toBe(0)
  })

  // Nothing to fetch must not start Music at all: an import of a fully tagged folder
  // should cost nothing extra.
  it('asks Music for nothing when every file carries its own art', async () => {
    const d = deps({ hasEmbedded: vi.fn(async () => true) })

    await attachMissingArtwork(tracks, d)

    expect(d.fetchArtwork).not.toHaveBeenCalled()
  })

  // The covers are a bonus on top of an import that already worked. If Music refuses, the
  // tracks still arrive with their files and their tags rather than the import failing.
  it('returns the import unchanged when the artwork fetch fails', async () => {
    const d = deps({
      fetchArtwork: vi.fn(async () => {
        throw new Error('Music is not running')
      }),
    })

    const out = await attachMissingArtwork(tracks, d)

    expect(out.paths).toEqual(tracks.paths)
    expect(out.meta['/m/one.wav'].coverPath).toBeUndefined()
  })

  // Music writes nothing for a track whose artwork vanished between the listing and the
  // fetch, so a path that never landed must not be handed on as if it had.
  it('does not attach a cover the fetch did not write', async () => {
    const d = deps({ fetchArtwork: vi.fn(async () => []) })

    const out = await attachMissingArtwork(tracks, d)

    expect(out.meta['/m/one.wav'].coverPath).toBeUndefined()
  })
})
