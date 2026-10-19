import { mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../shared/metadata'
import {
  CONTENT_LINK,
  type ContentFacts,
  insertContent,
  readContentFacts,
} from './rekordboxContentAdd'
import { openRekordboxDb } from './rekordboxDb'
import { rekordboxMetaFrom } from './rekordboxMetadata'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'

const NOW = new Date(2026, 9, 18, 23, 30)
const META = rekordboxMetaFrom({
  ...emptyMetadata(),
  title: 'Last Night',
  artist: 'Ultra Naté',
  album: 'Fussion V2',
  genre: 'Hard House',
  publisher: 'Blanco y Negro',
  trackNumber: '3',
})

function facts(over: Partial<ContentFacts> = {}): ContentFacts {
  return {
    path: '/Volumes/Public/Music/Last Night.wav',
    fileType: 11,
    fileSize: 81234567,
    inode: '-4611686018427387904',
    createdMs: new Date(2026, 2, 3, 12).getTime(),
    durationSec: 458.9,
    sampleRate: 44100,
    bitDepth: 16,
    bitRateKbps: 1411,
    meta: META,
    ...over,
  }
}

async function open() {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-rbadd-')), 'master.db')
  writeRekordboxPlaylistFixture(path, {
    ...ORGANISE_FIXTURE,
    artists: [{ ID: '508225883', Name: 'Ultra Naté' }],
  })
  const db = openRekordboxDb(path)
  if (!db) throw new Error('fixture did not open')
  return db
}

function probe(over: { bitDepth?: number | null; bitrateKbps?: number | null } = {}) {
  return {
    properties: async () => ({
      sampleRateHz: 44100,
      bitDepth: 16 as number | null,
      channels: 2,
      bitrateKbps: 1411 as number | null,
      ...over,
    }),
    duration: async () => 458.9,
  }
}

async function file(name: string, bytes: number): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-rbfacts-')), name)
  await writeFile(path, Buffer.alloc(bytes))
  return path
}

describe('readContentFacts', () => {
  it('reads size, inode as signed 64-bit text and type from the file as it is on disk, so relocate sees the same file', async () => {
    const path = await file('Last Night.wav', 1000)
    const st = await stat(path, { bigint: true })
    expect(await readContentFacts(path, META, probe())).toMatchObject({
      path,
      fileType: 11,
      fileSize: 1000,
      inode: BigInt.asIntN(64, st.ino).toString(),
      durationSec: 458.9,
      bitRateKbps: 1411,
      bitDepth: 16,
    })
  })

  it('gives a lossy file 16 bits and its own bit rate, as measured on MP3 rows', async () => {
    const path = await file('Goteras.mp3', 10)
    expect(
      await readContentFacts(path, META, probe({ bitDepth: null, bitrateKbps: 320 })),
    ).toMatchObject({ fileType: 1, bitDepth: 16, bitRateKbps: 320 })
  })

  it('refuses a format rekordbox does not import', async () => {
    expect(await readContentFacts(await file('x.ogg', 10), META, probe())).toBeNull()
  })
})

describe('insertContent', () => {
  it('writes the row in the mould rekordbox accepted and analysed on open', async () => {
    const db = await open()
    const id = insertContent(db, facts(), { now: NOW, newContentId: () => '142145108' })
    const row = db.prepare('SELECT * FROM djmdContent WHERE ID = ?').get(id) as Record<
      string,
      unknown
    >
    expect(row).toMatchObject({
      ID: '142145108',
      MasterSongID: '142145108',
      MasterDBID: '3216549870',
      DeviceID: '7',
      FolderPath: '/Volumes/Public/Music/Last Night.wav',
      FileNameL: 'Last Night.wav',
      FileType: 11,
      FileSize: 81234567,
      rb_file_id: '-4611686018427387904',
      Length: 458,
      BitRate: 1411,
      BitDepth: 16,
      SampleRate: 44100,
      DateCreated: '2026-03-03',
      StockDate: '2026-10-18',
      ContentLink: CONTENT_LINK,
      ExtInfo: 'null',
      BPM: 0,
      Analysed: 0,
      AnalysisDataPath: '',
      ImagePath: '',
      KeyID: null,
      CueUpdated: null,
      HotCueAutoLoad: 'on',
      Title: 'Last Night',
      rb_local_deleted: 0,
    })
    expect(Number(row.rb_local_usn)).toBeGreaterThan(500)
    db.close()
  })

  it('reuses the artist row rekordbox already has, so the browse view is not split in two', async () => {
    const db = await open()
    const id = insertContent(db, facts(), { now: NOW })
    expect(db.prepare('SELECT ArtistID FROM djmdContent WHERE ID = ?').get(id)).toEqual({
      ArtistID: '508225883',
    })
    expect(db.prepare('SELECT count(*) AS n FROM djmdArtist').get()).toEqual({ n: 1 })
    db.close()
  })

  it('leaves a WAV without label and track number, an AIFF with them, as measured on 1260 WAV rows', async () => {
    const db = await open()
    const wav = insertContent(db, facts(), { now: NOW })
    const aiff = insertContent(db, facts({ path: '/Volumes/Public/Music/B.aiff', fileType: 12 }), {
      now: NOW,
    })
    const read = (id: string) =>
      db.prepare('SELECT LabelID, TrackNo FROM djmdContent WHERE ID = ?').get(id) as {
        LabelID: string | null
        TrackNo: number
      }
    expect(read(wav)).toEqual({ LabelID: null, TrackNo: 0 })
    expect(read(aiff).LabelID).not.toBeNull()
    expect(read(aiff).TrackNo).toBe(3)
    db.close()
  })

  it('stores the path in NFC because every non-ASCII path in the measured collection is NFC while macOS hands Surco NFD', async () => {
    const db = await open()
    const nfd = '/Volumes/Public/Music/Café.wav'.normalize('NFD')
    const id = insertContent(db, facts({ path: nfd }), { now: NOW })
    expect(db.prepare('SELECT FolderPath FROM djmdContent WHERE ID = ?').get(id)).toEqual({
      FolderPath: '/Volumes/Public/Music/Café.wav'.normalize('NFC'),
    })
    db.close()
  })
})
