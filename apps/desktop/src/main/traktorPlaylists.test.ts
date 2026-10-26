import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RECENTLY_ADDED_ID } from '../shared/recentlyAdded'
import {
  nmlPath,
  readTraktorPlaylist,
  readTraktorRecentCount,
  readTraktorTree,
} from './traktorPlaylists'

const TRAKTOR_4 = readFileSync(
  join(import.meta.dirname, 'fixtures', 'traktor-pro-4-collection.nml'),
  'utf8',
)

interface Track {
  file: string
  volume?: string
  dir?: string
  title?: string
  artist?: string
  imported?: string
  info?: string
  extra?: string
}

const entryOf = (t: Track) =>
  `<ENTRY TITLE="${t.title ?? t.file}" ARTIST="${t.artist ?? ''}"><LOCATION DIR="${t.dir ?? '/:Users/:dj/:Music/:'}" FILE="${t.file}" VOLUME="${t.volume ?? 'Macintosh HD'}" VOLUMEID="v"></LOCATION><INFO PLAYTIME="200" PLAYTIME_FLOAT="200.500000" IMPORT_DATE="${t.imported ?? '2020/1/1'}"${t.info ?? ''}></INFO>${t.extra ?? ''}</ENTRY>`

const keyOf = (t: Track) =>
  `${t.volume ?? 'Macintosh HD'}${t.dir ?? '/:Users/:dj/:Music/:'}${t.file}`

const playlist = (name: string, uuid: string, tracks: Track[]) =>
  `<NODE TYPE="PLAYLIST" NAME="${name}"><PLAYLIST ENTRIES="${tracks.length}" TYPE="LIST" UUID="${uuid}">${tracks
    .map((t) => `<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="${keyOf(t)}"></PRIMARYKEY></ENTRY>`)
    .join('')}</PLAYLIST></NODE>`

const folder = (name: string, children: string[]) =>
  `<NODE TYPE="FOLDER" NAME="${name}"><SUBNODES COUNT="${children.length}">${children.join('')}</SUBNODES></NODE>`

const smartlist = (name: string) =>
  `<NODE TYPE="SMARTLIST" NAME="${name}"><SMARTLIST UUID="s1"><SEARCH_EXPRESSION VERSION="1" QUERY="$RATING &gt; 3"></SEARCH_EXPRESSION></SMARTLIST></NODE>`

const nml = (tracks: Track[], nodes: string[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<NML VERSION="20"><COLLECTION ENTRIES="${tracks.length}">${tracks
    .map(entryOf)
    .join('')}</COLLECTION><PLAYLISTS>${folder('$ROOT', nodes)}</PLAYLISTS></NML>`

const A: Track = { file: 'a.mp3', title: 'Alpha', artist: 'Ann' }
const B: Track = { file: 'b.flac', title: 'Beta', artist: 'Bob' }
const C: Track = { file: 'c.aiff', title: 'Gamma', artist: 'Cy', volume: 'Stick', dir: '/:Sets/:' }

describe('readTraktorTree', () => {
  it('draws the playlists and folders in the order Traktor shows them, under its hidden root', () => {
    const tree = readTraktorTree(
      nml(
        [A, B],
        [
          playlist('Preparation', 'p0', []),
          folder('Djotas', [playlist('Friday', 'p1', [A, B]), folder('Old', [])]),
        ],
      ),
    )
    expect(tree).toEqual([
      { id: 'p0', name: 'Preparation', kind: 'playlist', count: 0 },
      {
        id: 'folder:Djotas',
        name: 'Djotas',
        kind: 'folder',
        count: 2,
        children: [
          { id: 'p1', name: 'Friday', kind: 'playlist', count: 2 },
          { id: 'folder:Djotas/Old', name: 'Old', kind: 'folder', count: 0, children: [] },
        ],
      },
    ])
  })

  it('leaves out smart playlists, whose tracks come from a search Surco cannot run', () => {
    const tree = readTraktorTree(nml([A], [smartlist('Top rated'), playlist('Friday', 'p1', [A])]))
    expect(tree.map((n) => n.name)).toEqual(['Friday'])
  })

  it('reads names the way Traktor escaped them, so "Drum & Bass" is not shown as "&amp;"', () => {
    const tree = readTraktorTree(nml([], [playlist('Drum &amp; Bass', 'p1', [])]))
    expect(tree[0].name).toBe('Drum & Bass')
  })

  it('reads a collection with no playlists at all as an empty tree, not a failure', () => {
    expect(readTraktorTree(TRAKTOR_4)).toEqual([])
  })
})

describe('readTraktorPlaylist', () => {
  it('lists the tracks in the playlist order with the file each one points at', () => {
    const entries = readTraktorPlaylist(
      nml([A, B, C], [playlist('Friday', 'p1', [B, C, A])]),
      'p1',
      'Macintosh HD',
    )
    expect(entries.map((e) => e.path)).toEqual([
      '/Users/dj/Music/b.flac',
      '/Volumes/Stick/Sets/c.aiff',
      '/Users/dj/Music/a.mp3',
    ])
    expect(entries[0].preview).toMatchObject({ title: 'Beta', artist: 'Bob', durationSec: 200.5 })
  })

  it('finds a file on a Windows drive, where Traktor stores the drive letter as the volume', () => {
    const W: Track = { file: 'w.mp3', volume: 'D:', dir: '/:Music/:' }
    const [entry] = readTraktorPlaylist(nml([W], [playlist('L', 'p1', [W])]), 'p1', '')
    expect(entry.path).toBe('D:\\Music\\w.mp3')
  })

  it('carries the BPM and stars Traktor holds, on the 0-100 scale every source fills from', () => {
    const rated: Track = {
      ...A,
      info: ' RANKING="153"',
      extra: '<TEMPO BPM="124.000496" BPM_QUALITY="100.000000"></TEMPO>',
    }
    const [entry] = readTraktorPlaylist(nml([rated], [playlist('L', 'p1', [rated])]), 'p1', '')
    expect(entry.meta).toEqual({ bpm: '124', rating: 60 })
  })

  it('shows the hot cues on the row in their slots, and the cues without a slot as memory cues', () => {
    const cued: Track = {
      ...A,
      extra:
        '<CUE_V2 NAME="AutoGrid" TYPE="4" START="16.2" LEN="0" REPEATS="-1" HOTCUE="-1"><GRID BPM="124"></GRID></CUE_V2>' +
        '<CUE_V2 NAME="n.n." TYPE="0" START="8088.7" LEN="0" REPEATS="-1" HOTCUE="2"></CUE_V2>' +
        '<CUE_V2 NAME="n.n." TYPE="0" START="30000" LEN="0" REPEATS="-1" HOTCUE="-1"></CUE_V2>',
    }
    const [entry] = readTraktorPlaylist(nml([cued], [playlist('L', 'p1', [cued])]), 'p1', '')
    expect(entry.preview?.cues).toEqual([
      { ms: 8088.7, kind: 3, color: null },
      { ms: 30000, kind: 0, color: null },
    ])
  })

  it('keeps a row whose track is missing from the collection as one with no file, so the count stays honest', () => {
    const entries = readTraktorPlaylist(
      nml([A], [playlist('L', 'p1', [A, B])]),
      'p1',
      'Macintosh HD',
    )
    expect(entries.map((e) => e.path)).toEqual(['/Users/dj/Music/a.mp3', null])
  })

  it('reads an unknown playlist as empty', () => {
    expect(readTraktorPlaylist(nml([A], []), 'nope', '')).toEqual([])
  })
})

describe('recently added', () => {
  const now = new Date(2026, 9, 26, 12)
  const tracks: Track[] = [
    { ...A, imported: '2026/10/20' },
    { ...B, imported: '2026/9/26' },
    { ...C, imported: '2026/9/25' },
    { file: 'd.mp3', imported: '2026/10/20' },
  ]

  it('counts the tracks imported in the last 30 days, as the rekordbox and Engine tabs do', () => {
    expect(readTraktorRecentCount(nml(tracks, []), now)).toBe(3)
  })

  it('lists them newest first, the later import of the same day ahead', () => {
    const entries = readTraktorPlaylist(nml(tracks, []), RECENTLY_ADDED_ID, 'Macintosh HD', now)
    expect(entries.map((e) => e.path)).toEqual([
      '/Users/dj/Music/d.mp3',
      '/Users/dj/Music/a.mp3',
      '/Users/dj/Music/b.flac',
    ])
  })
})

describe('nmlPath', () => {
  it('reads the collection the DJ set in Settings, since it may not live where Traktor puts it', () => {
    expect(nmlPath('/local/collection.nml', ['/docs/collection.nml'], () => true)).toBe(
      '/local/collection.nml',
    )
  })

  it('falls back to the newest Traktor found on the machine when none is set or it is gone', () => {
    const exists = (p: string) => p !== '/gone.nml' && p !== '/docs/4.5/collection.nml'
    expect(
      nmlPath('/gone.nml', ['/docs/4.5/collection.nml', '/docs/4.4/collection.nml'], exists),
    ).toBe('/docs/4.4/collection.nml')
    expect(nmlPath('', [], exists)).toBe('')
  })
})
