import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { TrackProperties } from '../shared/types'
import { FILE_TYPES } from './rekordboxDb'
import { applyRekordboxMeta, type RekordboxMeta } from './rekordboxMetadata'
import { randomPlaylistId } from './rekordboxPlaylistEdit'
import { rekordboxStamp, takeLocalUsn, unusedRowId } from './rekordboxRows'

type Db = InstanceType<typeof Database>

export const CONTENT_LINK = 2950670

export interface ContentFacts {
  path: string
  fileType: number
  fileSize: number
  inode: string
  createdMs: number
  durationSec: number
  sampleRate: number
  bitDepth: number
  bitRateKbps: number
  meta: RekordboxMeta
}

export interface ContentProbe {
  properties: (
    path: string,
  ) => Promise<Pick<TrackProperties, 'sampleRateHz' | 'bitDepth' | 'channels' | 'bitrateKbps'>>
  duration: (path: string) => Promise<number | null>
}

const PCM = new Set([11, 12])
const LOSSY = new Set([1, 4])

export async function readContentFacts(
  path: string,
  meta: RekordboxMeta,
  probe: ContentProbe,
): Promise<ContentFacts | null> {
  const fileType = FILE_TYPES[extname(path).slice(1).toLowerCase()]
  if (fileType === undefined) return null
  const [st, props, duration] = await Promise.all([
    stat(path, { bigint: true }),
    probe.properties(path),
    probe.duration(path),
  ])
  if (duration === null) return null
  const bitDepth = LOSSY.has(fileType) ? 16 : (props.bitDepth ?? 16)
  return {
    path,
    fileType,
    fileSize: Number(st.size),
    inode: BigInt.asIntN(64, st.ino).toString(),
    createdMs: Number(st.birthtimeMs),
    durationSec: duration,
    sampleRate: props.sampleRateHz,
    bitDepth,
    bitRateKbps: PCM.has(fileType)
      ? Math.floor((props.sampleRateHz * bitDepth * props.channels) / 1000)
      : (props.bitrateKbps ?? 0),
    meta,
  }
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function insertContent(
  db: Db,
  facts: ContentFacts,
  ctx: { now: Date; newContentId?: () => string },
): string {
  const stamp = rekordboxStamp(ctx.now)
  const device = db.prepare('SELECT ID, MasterDBID FROM djmdDevice LIMIT 1').get() as
    | { ID: string; MasterDBID: string }
    | undefined
  if (!device) throw new Error('rekordbox collection has no djmdDevice row')
  const id = unusedRowId(db, 'djmdContent', ctx.newContentId ?? randomPlaylistId)
  const folderPath = facts.path.normalize('NFC')
  const fileName = basename(folderPath)
  const row: Record<string, string | number | null> = {
    ID: id,
    FolderPath: folderPath,
    FileNameL: fileName,
    FileNameS: '',
    Title: facts.meta.title.trim() || basename(fileName, extname(fileName)),
    BPM: 0,
    Length: Math.floor(facts.durationSec),
    TrackNo: 0,
    BitRate: facts.bitRateKbps,
    BitDepth: facts.bitDepth,
    Commnt: '',
    FileType: facts.fileType,
    Rating: 0,
    ReleaseYear: 0,
    KeyID: null,
    StockDate: localDate(ctx.now),
    ColorID: '0',
    DJPlayCount: 0,
    ImagePath: '',
    MasterDBID: device.MasterDBID,
    MasterSongID: id,
    AnalysisDataPath: '',
    FileSize: facts.fileSize,
    DiscNo: 0,
    Subtitle: '',
    SampleRate: facts.sampleRate,
    Analysed: 0,
    ReleaseDate: '',
    DateCreated: localDate(new Date(facts.createdMs)),
    ContentLink: CONTENT_LINK,
    ModifiedByRBM: '',
    HotCueAutoLoad: 'on',
    DeliveryControl: 'on',
    DeliveryComment: '',
    CueUpdated: null,
    AnalysisUpdated: null,
    TrackInfoUpdated: null,
    Lyricist: '',
    ISRC: '',
    SamplerTrackInfo: 0,
    SamplerPlayOffset: 0,
    SamplerGain: 0,
    VideoAssociate: '0',
    LyricStatus: 0,
    ServiceID: 0,
    OrgFolderPath: '',
    Reserved1: '',
    ExtInfo: 'null',
    rb_file_id: facts.inode,
    DeviceID: device.ID,
    UUID: randomUUID(),
    rb_data_status: 0,
    rb_local_data_status: 0,
    rb_local_deleted: 0,
    rb_local_synced: 0,
    usn: null,
    rb_local_usn: takeLocalUsn(db, stamp),
    created_at: stamp,
    updated_at: stamp,
  }
  const names = Object.keys(row)
  db.prepare(
    `INSERT INTO djmdContent (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
  ).run(...Object.values(row))
  const meta = facts.fileType === 11 ? { ...facts.meta, label: '', trackNumber: '' } : facts.meta
  applyRekordboxMeta(db, id, meta, { now: ctx.now })
  return id
}
