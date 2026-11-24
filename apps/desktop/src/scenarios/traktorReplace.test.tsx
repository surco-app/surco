// @vitest-environment jsdom
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())
vi.mock('../main/applemusic', async (original) => ({
  ...(await import('./fakeMusic')).appleMusicModule(await original()),
  scenarioFake: true,
}))
vi.mock('../main/appleMusicPlaylists', async () => (await import('./fakeMusic')).playlistsModule())
vi.mock('../main/appleMusicArtwork', async (original) =>
  (await import('./fakeMusic')).artworkModule(await original()),
)
// The sync checks for a running Traktor with a real pgrep, so on a machine with Traktor
// open the collection was never written and the scenario timed out.
vi.mock('../main/traktorProcess', () => ({ isTraktorRunning: vi.fn().mockResolvedValue(false) }))

import { toNmlLocation } from '../main/ffmpeg'
import { backupOf } from '../main/libraryBackups'
import { entryCues, findEntries } from '../main/traktorNml'
import { bootVolumeName } from '../main/traktorNmlLibrary'
import { osTrash } from './electronFake'
import { music } from './fakeMusic'
import { makeTrack, scenarioDir } from './fixtures'
import { openSurco, type Scenario } from './harness'

const HOT_CUE =
  '<CUE_V2 NAME="Drop" DISPL_ORDER="0" TYPE="0" START="32000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="1"></CUE_V2>'
const GRID_CUE =
  '<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="120.000000" LEN="0.000000" REPEATS="-1" HOTCUE="-1"></CUE_V2>'

// findEntries also matches the playlist's ENTRY blocks, which carry no LOCATION.
const collectionEntries = (nml: string) => findEntries(nml).filter((e) => e.file !== '')

function locationOf(path: string) {
  const { volume: pathVolume, dir, file } = toNmlLocation(path)
  const volume = pathVolume || bootVolumeName()
  return { volume, dir, file, key: `${volume}${dir}${file}` }
}

// taken: the new file already has an ENTRY of its own (the DJ dragged the download into
// Traktor before replacing), so the old entry has nowhere to move.
function collection(old: string, taken?: string): { xml: string; key: string } {
  const { volume, dir, file, key } = locationOf(old)
  const own = taken && locationOf(taken)
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<NML VERSION="19"><HEAD COMPANY="www.native-instruments.com" PROGRAM="Traktor"></HEAD>
<COLLECTION ENTRIES="${own ? 2 : 1}">
<ENTRY MODIFIED_DATE="2026/10/14" TITLE="Show Me Love" ARTIST="Robin S"><LOCATION DIR="${dir}" FILE="${file}" VOLUME="${volume}" VOLUMEID="${volume}"></LOCATION>
<INFO RANKING="204"></INFO>
<TEMPO BPM="120.000000" BPM_QUALITY="100.000000"></TEMPO>
${HOT_CUE}
${GRID_CUE}
</ENTRY>
${own ? `<ENTRY TITLE="Show Me Love" ARTIST="Robin S"><LOCATION DIR="${own.dir}" FILE="${own.file}" VOLUME="${own.volume}" VOLUMEID="${own.volume}"></LOCATION>\n</ENTRY>\n` : ''}</COLLECTION>
<PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="1">
<NODE TYPE="PLAYLIST" NAME="Peak"><PLAYLIST ENTRIES="1" TYPE="LIST" UUID="peak">
<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="${key}"></PRIMARYKEY></ENTRY>
</PLAYLIST></NODE>
</SUBNODES></NODE></PLAYLISTS>
</NML>
`
  return { xml, key }
}

// Before this, replacing a track kept in Traktor left its entry on the old file; Surco then
// moved that file to the Trash and Traktor lost the track, with its cues, stars and place
// in every playlist. The DJ only finds out at the next gig, when the track shows as missing.
interface Outcome {
  after: () => string
  newFile: () => string
  newKey: () => string
  nml: () => string
  trashed: () => string[]
  errors: () => string[]
  traktorCheck: () => string | undefined
}

function swapScenario(
  settings: { syncTraktor: boolean; addToTraktor: boolean },
  name: string,
  tests: (outcome: Outcome) => void,
  options: { outputTaken?: boolean } = {},
) {
  describe.skipIf(process.platform !== 'darwin')(name, () => {
    let surco: Scenario
    let nml: string
    let newFile: string
    let newKey: string
    let before: string
    let after: string
    let osTrashAfterRetire: string[]

    beforeAll(async () => {
      const root = scenarioDir('traktor-replace')
      const library = join(root, 'Music')
      const media = join(root, 'Media')
      const old = makeTrack(join(library, 'Show Me Love.mp3'), {
        title: 'Show Me Love',
        artist: 'Robin S',
        signal: 'kick',
      })
      makeTrack(join(root, 'Downloads', 'Robin S - Show Me Love.flac'), {
        title: 'Show Me Love',
        artist: 'Robin S',
        signal: 'kick',
      })
      music.reset()
      music.state.mediaFolder = media
      music.addEntry({
        location: old,
        title: 'Show Me Love',
        artist: 'Robin S',
        durationSec: 8,
      })
      nml = join(scenarioDir('traktor-replace-library'), 'collection.nml')
      before = collection(
        old,
        options.outputTaken ? join(media, 'Robin S - Show Me Love.aiff') : undefined,
      ).xml
      writeFileSync(nml, before)

      surco = await openSurco({
        verify: true,
        settings: { outputFormat: 'aiff', ...settings, traktorNmlPath: nml },
        destination: 'appleMusic',
      })
      // osTrash outlives each scenario: only what this swap sent to the Trash counts, or one
      // scenario's retired file would answer for the next.
      const trashedBefore = osTrash.length
      const trashedNow = () => osTrash.slice(trashedBefore).map((p) => basename(p))
      await surco.drop(join(root, 'Downloads'))
      await surco.convertInEditor('Robin S - Show Me Love.flac', 'replace')
      if (options.outputTaken) {
        await waitFor(
          () =>
            expect(surco.verification('Robin S - Show Me Love.flac')?.status).toMatch(
              /^(ok|mismatch)$/,
            ),
          { timeout: 60_000 },
        )
        await surco.settled()
      } else {
        await waitFor(() => expect(trashedNow()).toContain('Show Me Love.mp3'), {
          timeout: 60_000,
        })
      }
      osTrashAfterRetire = trashedNow()
      const landed = music.state.added[0].persistentId
      newFile = music.entry(landed)?.location ?? ''
      const { volume, dir, file } = toNmlLocation(newFile)
      newKey = `${volume || bootVolumeName()}${dir}${file}`
      after = readFileSync(nml, 'utf8')
    }, 120_000)

    afterAll(() => {
      surco.close()
    })

    tests({
      after: () => after,
      newFile: () => newFile,
      newKey: () => newKey,
      nml: () => nml,
      trashed: () => osTrashAfterRetire,
      errors: () => surco.errors,
      traktorCheck: () =>
        surco.verification('Robin S - Show Me Love.flac')?.checks.find((c) => c.place === 'traktor')
          ?.detail.key,
    })
  })
}

swapScenario(
  { syncTraktor: true, addToTraktor: true },
  'Swap a track kept in Traktor for a better copy',
  (o) => {
    it("keeps the track in Traktor, now on the new AIFF in Music's folder", () => {
      const entries = collectionEntries(o.after())
      expect(entries).toHaveLength(1)
      const { volume, dir, file } = toNmlLocation(o.newFile())
      expect(entries[0]).toMatchObject({ volume: volume || bootVolumeName(), dir, file })
    })

    it('carries every cue Traktor kept, unmoved', () => {
      expect(entryCues(o.after())).toBe(HOT_CUE + GRID_CUE)
    })

    it('keeps its stars and its place in the playlist', () => {
      expect(o.after()).toContain('RANKING="204"')
      expect(o.after()).toContain(`<PRIMARYKEY TYPE="TRACK" KEY="${o.newKey()}">`)
    })

    it('retires the old file only once Traktor follows the new one', () => {
      expect(o.trashed()).toContain('Show Me Love.mp3')
    })

    it('keeps a copy of the collection as it was', () => {
      expect(readFileSync(backupOf(o.nml(), 'backup'), 'utf8')).toContain('FILE="Show Me Love.mp3"')
    })

    it('runs without a single error the user would see', () => {
      expect(o.errors()).toEqual([])
    })
  },
)

// Add to Traktor alone writes no stars, so the entry must still move whole or the track is
// lost in Traktor exactly as when sync is on.
swapScenario(
  { syncTraktor: false, addToTraktor: true },
  'Swap a track kept in Traktor with only Add to Traktor on',
  (o) => {
    it('with only Add to Traktor on, the old entry still moves to the new file', () => {
      const entries = collectionEntries(o.after())
      expect(entries).toHaveLength(1)
      const { volume, dir, file } = toNmlLocation(o.newFile())
      expect(entries[0]).toMatchObject({ volume: volume || bootVolumeName(), dir, file })
      expect(entryCues(o.after())).toBe(HOT_CUE + GRID_CUE)
    })

    it('keeps its stars as Traktor had them', () => {
      expect(o.after()).toContain('RANKING="204"')
    })
  },
)

// The move is refused when the new file already has its own entry: the old entry, with its
// cues and playlists, still points at the old file. Retiring that file then would leave the
// DJ's real entry missing in Traktor, so it has to stay until the DJ sorts the two out.
for (const settings of [
  { syncTraktor: false, addToTraktor: true },
  { syncTraktor: true, addToTraktor: true },
]) {
  swapScenario(
    settings,
    `Swap a track whose new file Traktor already has (${settings.syncTraktor ? 'Sync Traktor' : 'only Add to Traktor'})`,
    (o) => {
      it('keeps the old file while its entry could not follow', () => {
        expect(o.trashed()).not.toContain('Show Me Love.mp3')
      })

      // The check is what tells the DJ the swap is not finished in Traktor; reading ok, the
      // old file is kept only by the last look at the collection before the Trash.
      it('says Traktor still has the track on the old file', () => {
        expect(o.traktorCheck()).toBe('traktorStillOld')
      })

      it('leaves the old entry and its cues where they were', () => {
        expect(o.after()).toContain('FILE="Show Me Love.mp3"')
        expect(o.after()).toContain(HOT_CUE)
      })
    },
    { outputTaken: true },
  )
}
