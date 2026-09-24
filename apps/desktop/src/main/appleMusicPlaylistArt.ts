import { join } from 'node:path'
import type { AppleMusicPlaylistTracks } from '../shared/types'
import { missingArtwork } from './appleMusicArtwork'

// Fills in the covers a playlist import cannot get from the files themselves.
//
// Measured on a real library: 53% of the tracks carry no embedded picture — almost all of
// them WAVs — while Music holds the artwork for the very same track. Those rows imported
// with an empty cover slot, which is what the user reported with a screenshot of Music
// showing the very art that was missing in Surco.
//
// Only the files without their own picture are fetched. The other half already carry
// full-resolution art, and that is what should be shown anyway.

export interface AttachArtworkDeps {
  hasEmbedded: (path: string) => Promise<boolean>
  // Writes each track's picture and resolves with the covers that really landed — a track
  // whose artwork vanished between the listing and the fetch simply has none.
  fetchArtwork: (
    jobs: { persistentId: string; outPath: string }[],
  ) => Promise<{ path: string; url: string }[]>
  outDir: () => Promise<string>
}

export async function attachMissingArtwork(
  tracks: AppleMusicPlaylistTracks,
  deps: AttachArtworkDeps,
): Promise<AppleMusicPlaylistTracks> {
  const need = await missingArtwork(
    // An import can arrive with no ID map at all (a playlist Music reported nothing for);
    // without a library entry there is nowhere to fetch art from, which missingArtwork
    // already treats as "skip".
    tracks.paths.map((path) => ({ path, persistentId: tracks.persistentIds?.[path] })),
    { hasEmbedded: deps.hasEmbedded },
  )
  // Nothing to fetch must not start Music at all: importing a fully tagged folder should
  // cost nothing extra.
  if (need.length === 0) return tracks

  try {
    const dir = await deps.outDir()
    const jobs = need.map((t) => ({
      persistentId: t.persistentId,
      outPath: join(dir, `${t.persistentId}.jpg`),
    }))
    const written = new Map((await deps.fetchArtwork(jobs)).map((cover) => [cover.path, cover.url]))
    // An import that reported no meta map at all still has to survive: the covers are an
    // addition to it, not something it can be assumed to already hold.
    const meta = { ...tracks.meta }
    for (const track of need) {
      const outPath = join(dir, `${track.persistentId}.jpg`)
      // Only a cover that really landed: handing on a path Music never wrote would show a
      // broken image instead of the empty slot it replaced.
      const url = written.get(outPath)
      if (!url) continue
      meta[track.path] = { ...(meta[track.path] ?? {}), coverPath: outPath, coverUrl: url }
    }
    return { ...tracks, meta }
  } catch {
    // The covers are a bonus on top of an import that already worked; Music refusing must
    // not cost the user the tracks themselves.
    return tracks
  }
}
