import { describe, expect, it } from 'vitest'
import { buildBakenXml } from './bakenXml'
import { readTraktorExportSelection, traktorExportDelta } from './usbExportTraktor'

interface Track {
  file: string
  playtime?: string
  playtimeFloat?: string
  volume?: string
  dir?: string
  title?: string
  artist?: string
  imported?: string
  info?: string
  extra?: string
}

const entryOf = (t: Track) =>
  `<ENTRY TITLE="${t.title ?? t.file}" ARTIST="${t.artist ?? ''}"><LOCATION DIR="${t.dir ?? '/:Users/:dj/:Music/:'}" FILE="${t.file}" VOLUME="${t.volume ?? 'Macintosh HD'}" VOLUMEID="v"></LOCATION><INFO PLAYTIME="${t.playtime ?? '200'}" PLAYTIME_FLOAT="${t.playtimeFloat ?? '200.500000'}" IMPORT_DATE="${t.imported ?? '2020/1/1'}"${t.info ?? ''}></INFO>${t.extra ?? ''}</ENTRY>`

const keyOf = (t: Track) =>
  `${t.volume ?? 'Macintosh HD'}${t.dir ?? '/:Users/:dj/:Music/:'}${t.file}`

const playlist = (name: string, uuid: string, tracks: Track[]) =>
  `<NODE TYPE="PLAYLIST" NAME="${name}"><PLAYLIST ENTRIES="${tracks.length}" TYPE="LIST" UUID="${uuid}">${tracks
    .map((t) => `<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="${keyOf(t)}"></PRIMARYKEY></ENTRY>`)
    .join('')}</PLAYLIST></NODE>`

const folder = (name: string, children: string[]) =>
  `<NODE TYPE="FOLDER" NAME="${name}"><SUBNODES COUNT="${children.length}">${children.join('')}</SUBNODES></NODE>`

const nml = (tracks: Track[], nodes: string[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<NML VERSION="20"><COLLECTION ENTRIES="${tracks.length}">${tracks
    .map(entryOf)
    .join('')}</COLLECTION><PLAYLISTS>${folder('$ROOT', nodes)}</PLAYLISTS></NML>`

const W: Track = {
  file: 'w.wav',
  title: 'Bumpy',
  artist: 'Bumpin Flava',
  playtime: '142',
  playtimeFloat: '141.348572',
  imported: '2024/6/18',
  info: ' BITRATE="299672" LABEL="Native Instruments" KEY="Ebm" RANKING="153" RELEASE_DATE="2019/1/1"',
  extra: [
    '<ALBUM TITLE="Maschine Expansion" TRACK="3"></ALBUM>',
    '<TEMPO BPM="136.000000" BPM_QUALITY="100.000000"></TEMPO>',
    '<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="0" START="71.622549" LEN="0.000000" REPEATS="-1" HOTCUE="0"></CUE_V2>',
    '<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="1836.328431" LEN="0.000000" REPEATS="-1" HOTCUE="-1"><GRID BPM="136.000000"></GRID></CUE_V2>',
    '<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="0" START="28306.916666" LEN="0.000000" REPEATS="-1" HOTCUE="1"></CUE_V2>',
    '<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="5" START="10000.000000" LEN="4000.000000" REPEATS="-1" HOTCUE="2"></CUE_V2>',
    '<CUE_V2 NAME="Break" DISPL_ORDER="0" TYPE="0" START="50000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="-1"></CUE_V2>',
  ].join(''),
}

const M: Track = {
  file: 'm.mp3',
  title: 'Mu',
  extra:
    '<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="0" START="5000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="1"></CUE_V2>',
}

const NML = nml(
  [W, M],
  [folder('Sets', [playlist('Friday', 'p1', [W, M]), playlist('Saturday', 'p2', [W])])],
)

const deps = {
  bootVolume: 'Macintosh HD',
  deltaOf: async (file: string) => (file.endsWith('.wav') ? 0 : null),
}

describe('readTraktorExportSelection', () => {
  it('exports a playlist inside its folder, in order, with each ENTRY facts', async () => {
    const sel = await readTraktorExportSelection(NML, ['p1'], deps)
    expect(sel.playlists).toMatchObject([
      { id: 'p1', name: 'Friday', folders: ['Sets'], folderIds: ['folder:Sets'], updatedAt: 0 },
    ])
    expect(sel.tracks.map((t) => t.path)).toEqual([
      '/Users/dj/Music/w.wav',
      '/Users/dj/Music/m.mp3',
    ])
    expect(sel.tracks[0]).toMatchObject({
      title: 'Bumpy',
      artist: 'Bumpin Flava',
      album: 'Maschine Expansion',
      trackNo: 3,
      key: 'Ebm',
      bpm: 136,
      rating: 3,
      dateAdded: '2024-06-18',
      year: 2019,
      bitRate: 300,
      lengthSec: 142,
      label: 'Native Instruments',
      fileType: 11,
    })
  })

  it('gives hot cues Surco letters, keeps the load cue and unbuttoned cues as memory cues, and loops with their end', async () => {
    const sel = await readTraktorExportSelection(NML, ['p1'], deps)
    expect(sel.tracks[0].cues).toEqual([
      { inMs: 71.622549, outMs: -1, kind: 0, comment: '' },
      { inMs: 28306.916666, outMs: -1, kind: 1, comment: '' },
      { inMs: 10000, outMs: 14000, kind: 2, comment: '' },
      { inMs: 50000, outMs: -1, kind: 0, comment: 'Break' },
    ])
  })

  it('puts the AutoGrid marker on one TEMPO at 136 BPM', async () => {
    const sel = await readTraktorExportSelection(NML, ['p1'], deps)
    const xml = buildBakenXml(
      sel,
      new Map(sel.tracks.map((t) => [t.id, { size: 1, grid: t.grid ?? [] }])),
      'darwin',
    )
    expect(xml.match(/<TEMPO [^>]*Bpm="136.00"/g)).toHaveLength(1)
    expect(xml).toMatch(
      /<NODE Type="0" Name="Sets" Count="1">\n<NODE Name="Friday" Type="1" KeyType="0" Entries="2">/,
    )
  })

  it('exports an MP3 whose lead Traktor never measured without cues or grid, and marks it', async () => {
    const sel = await readTraktorExportSelection(NML, ['p1'], deps)
    expect(sel.tracks[1]).toMatchObject({ cues: [], cuesLeftOut: true })
    expect(sel.tracks[1].grid ?? []).toEqual([])
    expect(sel.tracks[0].cuesLeftOut).toBeFalsy()
  })

  it('does not mark an unmeasured MP3 that had neither cues nor grid, as nothing was left out', async () => {
    const bare: Track = { file: 'bare.mp3' }
    const sel = await readTraktorExportSelection(
      nml([bare], [playlist('Plain', 'p4', [bare])]),
      ['p4'],
      deps,
    )
    expect(sel.tracks[0].cuesLeftOut).toBeFalsy()
  })

  it('gives a track two playlists share one id and one entry', async () => {
    const sel = await readTraktorExportSelection(NML, ['p1', 'p2'], deps)
    expect(sel.tracks).toHaveLength(2)
    expect(sel.playlists[1].trackIds).toEqual([sel.playlists[0].trackIds[0]])
  })

  it('leaves out a row whose track is no longer in the collection', async () => {
    const sel = await readTraktorExportSelection(
      nml([W], [playlist('Odd', 'p3', [W, { file: 'ghost.mp3' }])]),
      ['p3'],
      deps,
    )
    expect(sel.playlists[0].trackIds).toHaveLength(1)
    expect(sel.tracks).toHaveLength(1)
  })
})

describe('traktorExportDelta', () => {
  it('knows the lead of a WAV, and not that of an M4A or an MP3 that is not there', async () => {
    expect(await traktorExportDelta('/m/a.wav')).toBe(0)
    expect(await traktorExportDelta('/m/a.m4a')).toBeNull()
    expect(await traktorExportDelta('/nowhere/a.mp3')).toBeNull()
  })
})
