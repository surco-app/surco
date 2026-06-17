import { ratingTagToStars } from '../shared/rating'
import type { TrackMetadata } from '../shared/types'

// The per-field tag mapping shared by the reader (tagsFromProbe) and the writer
// (metadataArgs): the ffprobe aliases a field is read from and the muxer name(s) it is
// written to. Co-locating both directions means adding a metadata field is one entry
// here instead of an edit to two functions that silently drift.
export interface TagField {
  key: keyof TrackMetadata
  // ffprobe tag keys to read from, lowercased, in priority order (first non-empty wins).
  aliases: string[]
  // The name ffmpeg writes on ID3 targets (AIFF/MP3/WAV). Omitted for a field not written
  // through ffmpeg's -metadata — rating rides POPM/Vorbis RATING via the TagLib pass.
  id3?: string
  // The write name on Vorbis/FLAC targets, where the FLAC muxer writes keys verbatim and
  // DJ software reads different names (BPM/INITIALKEY/REMIXER…). Defaults to id3 when the
  // two muxers share a name.
  vorbis?: string
  // Normalizes the raw probed string into the stored value: dropping a "3/12" track total,
  // the compilation flag, the rating stars. Identity when omitted.
  parse?: (raw: string) => string
}

// A "3/12" track or disc tag would survive zero-padding as "312", so keep only the index.
const dropTotal = (raw: string): string => raw.split('/')[0].trim()

export const TAG_FIELDS: TagField[] = [
  { key: 'title', aliases: ['title'], id3: 'title' },
  { key: 'artist', aliases: ['artist'], id3: 'artist' },
  { key: 'album', aliases: ['album'], id3: 'album' },
  {
    key: 'albumArtist',
    aliases: ['album_artist', 'albumartist', 'album artist'],
    id3: 'album_artist',
  },
  { key: 'year', aliases: ['date', 'year'], id3: 'date' },
  { key: 'genre', aliases: ['genre'], id3: 'genre' },
  { key: 'grouping', aliases: ['grouping', 'content_group', 'tit1', 'grp1'], id3: 'grouping' },
  { key: 'comment', aliases: ['comment'], id3: 'comment' },
  { key: 'trackNumber', aliases: ['track', 'tracknumber'], id3: 'track', parse: dropTotal },
  {
    key: 'discNumber',
    aliases: ['disc', 'tpos', 'disc_number', 'discnumber'],
    id3: 'disc',
    parse: dropTotal,
  },
  // ffmpeg maps these to the real ID3 frames DJ software and Music read (TBPM/TKEY/TPE4);
  // the FLAC muxer has no ID3 mapping and writes keys verbatim, so a Vorbis target gets the
  // comment names Traktor and Mixed In Key read instead.
  { key: 'bpm', aliases: ['tbpm', 'bpm'], id3: 'TBPM', vorbis: 'BPM' },
  { key: 'key', aliases: ['tkey', 'initial_key', 'initialkey'], id3: 'TKEY', vorbis: 'INITIALKEY' },
  { key: 'publisher', aliases: ['publisher', 'tpub', 'label', 'organization'], id3: 'publisher' },
  // The catalog number has no standard frame, so it rides the de-facto TXXX:CATALOGNUMBER.
  {
    key: 'catalogNumber',
    aliases: ['catalognumber', 'catalog_number', 'catalogue', 'catalog'],
    id3: 'CATALOGNUMBER',
  },
  {
    key: 'remixArtist',
    aliases: ['tpe4', 'remixer', 'remixed_by', 'remixedby', 'remix_artist'],
    id3: 'TPE4',
    vorbis: 'REMIXER',
  },
  {
    key: 'discogsReleaseId',
    aliases: ['discogs_release_id', 'discogs_releaseid', 'discogsreleaseid'],
    id3: 'DISCOGS_RELEASE_ID',
  },
  // ffprobe exposes FLAC's Vorbis RATING comment but not the ID3 POPM frame, so a rating
  // only round-trips for FLAC; MP3/AIFF start unrated. Written by the TagLib pass, not here.
  { key: 'rating', aliases: ['rating', 'rating wmp'], parse: ratingTagToStars },
  { key: 'composer', aliases: ['composer', 'tcom'], id3: 'composer' },
  { key: 'isrc', aliases: ['tsrc', 'isrc'], id3: 'TSRC', vorbis: 'ISRC' },
  {
    key: 'mixName',
    aliases: ['tit3', 'subtitle', 'mixname', 'mix_name'],
    id3: 'TIT3',
    vorbis: 'SUBTITLE',
  },
  // TORY, not TDOR: the ID3 targets are pinned to v2.3, where TDOR doesn't exist. TDOR is
  // its v2.4 successor and ORIGINALYEAR the Picard-convention Vorbis comment, both read.
  {
    key: 'originalYear',
    aliases: ['tory', 'tdor', 'originalyear', 'original_year'],
    id3: 'TORY',
    vorbis: 'ORIGINALYEAR',
  },
  // Boolean-ish flag: only a literal '1' counts as set, so a TCMP=0 (or junk) never shows
  // the checkbox ticked. 'compilation' is ffmpeg's mapped name for the TCMP frame iTunes reads.
  {
    key: 'compilation',
    aliases: ['compilation', 'tcmp', 'cpil'],
    id3: 'compilation',
    vorbis: 'COMPILATION',
    parse: (raw) => (raw === '1' ? '1' : ''),
  },
]
