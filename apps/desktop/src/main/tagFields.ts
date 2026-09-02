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
  // Extra Vorbis names written ALONGSIDE `vorbis`, for a field two programs spell
  // differently and both matter. Unlike an alias — which is read from and actively
  // cleared on write — every name here gets the value.
  vorbisAlso?: string[]
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
    aliases: ['album_artist', 'albumartist', 'album artist', 'albumartist2'],
    id3: 'album_artist',
  },
  { key: 'year', aliases: ['date', 'year'], id3: 'date' },
  { key: 'genre', aliases: ['genre'], id3: 'genre' },
  { key: 'grouping', aliases: ['grouping', 'content_group', 'tit1', 'grp1'], id3: 'grouping' },
  { key: 'comment', aliases: ['comment'], id3: 'comment' },
  {
    key: 'trackNumber',
    aliases: ['track', 'tracknumber', 'tracknum'],
    id3: 'track',
    parse: dropTotal,
  },
  {
    key: 'discNumber',
    aliases: ['disc', 'tpos', 'disc_number', 'discnumber'],
    id3: 'disc',
    parse: dropTotal,
  },
  // ffmpeg maps these to the real ID3 frames DJ software and Music read (TBPM/TKEY/TPE4);
  // the FLAC muxer has no ID3 mapping and writes keys verbatim, so a Vorbis target gets the
  // comment names Traktor and Mixed In Key read instead.
  // TBP/TKE are the ID3v2.2 spellings of TBPM/TKEY. ffprobe maps v2.2's common frames onto
  // its own names (TT2 -> title, TP1 -> artist) but passes these two through verbatim, so an
  // old v2.2 rip would otherwise read back with no key and no BPM. They go last: a file
  // retagged by a modern tool can keep the three-letter frame beside the current one, and the
  // frame the user's tagger just wrote is the one that must win.
  { key: 'bpm', aliases: ['tbpm', 'bpm', 'tbp'], id3: 'TBPM', vorbis: 'BPM' },
  // Both Vorbis spellings, for the same reason the record label carries LABEL and
  // PUBLISHER: djotas reads the key from KEY, and dropping INITIALKEY would blind
  // whatever reads that one instead. His own converted file carries both already.
  {
    key: 'key',
    aliases: ['tkey', 'initial_key', 'initialkey', 'tke'],
    id3: 'TKEY',
    vorbis: 'INITIALKEY',
    vorbisAlso: ['KEY'],
  },
  // Traktor reads the record label from Vorbis LABEL and shows PUBLISHER as a separate
  // column, so a FLAC carrying only one of them leaves the other blank — djotas proved it
  // by setting the two to different values and watching which column filled. ffmpeg wrote
  // just `publisher` here, and a FLAC conversion never takes the TagLib pass that would
  // have added LABEL (that only runs for .wav and .m4a), so the fix has to live here.
  {
    key: 'publisher',
    aliases: ['publisher', 'tpub', 'label', 'organization'],
    id3: 'publisher',
    vorbis: 'LABEL',
    vorbisAlso: ['PUBLISHER'],
  },
  // The catalog number has no standard frame, so it rides the de-facto TXXX:CATALOGNUMBER.
  {
    key: 'catalogNumber',
    aliases: ['catalognumber', 'catalog_number', 'catalogue', 'catalog', 'labelno'],
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
  // ffprobe exposes FLAC's Vorbis RATING comment but not the ID3 POPM frame, which is why
  // this parse alone left MP3/AIFF unrated. readMeta closes that gap by falling back to
  // TagLib's POPM reader when the probe finds nothing, so a rating round-trips everywhere
  // an ID3 tag can hold one. Written by the TagLib pass, not here.
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
  // TMOO is read (ffprobe surfaces it on a v2.4 file tagged elsewhere) but never written:
  // it has no ID3v2.3 frame, and the ID3 targets are pinned to v2.3. TXXX "MOOD" is the
  // name ffmpeg writes and mp3tag/Traktor read, so it round-trips on both muxers.
  { key: 'mood', aliases: ['tmoo', 'mood'], id3: 'MOOD' },
  // Energy has no standard frame; TXXX "ENERGY" is what Mixed In Key writes and the
  // Traktor/rekordbox crowd reads. Carried verbatim, with no scale of its own: Mixed In
  // Key writes 1-10, other taggers 1-5, some a word. Validating would mean dropping a
  // value the user's other tools had already written — the very loss this field exists
  // to stop — so it stays free text, like the key or the comment.
  // ENERGYLEVEL comes first: Platinum Notes stores its own base64 payload in TXXX
  // "ENERGY" while leaving the readable 1-10 level in ENERGYLEVEL, so on a file it has
  // touched the lower-priority name is the only one holding an energy a human wrote.
  { key: 'energy', aliases: ['energylevel', 'energy'], id3: 'ENERGY' },
  // The four a collector normalizes by, straight off the Discogs release. None has a
  // standard frame, so they ride TXXX (ID3) and a plain Vorbis comment under the exact
  // names mp3tag writes — the tool this was asked for is the one users already run by
  // hand, and a library tagged with both has to agree rather than grow duplicates.
  { key: 'style', aliases: ['style', 'styles'], id3: 'STYLE', vorbis: 'STYLE' },
  { key: 'country', aliases: ['country', 'releasecountry'], id3: 'COUNTRY', vorbis: 'COUNTRY' },
  {
    key: 'mediaType',
    aliases: ['mediatype', 'media', 'media_type'],
    id3: 'MEDIATYPE',
    vorbis: 'MEDIATYPE',
  },
  {
    key: 'discogsUrl',
    aliases: ['discogs_release_url', 'discogsreleaseurl', 'discogs_url', 'www'],
    id3: 'DISCOGS_RELEASE_URL',
    vorbis: 'DISCOGS_RELEASE_URL',
  },
]

// El conjunto plano de todos los alias que la app gestiona, en minúsculas. El lector
// de tags foráneos lo usa para saber qué NO es gestionado: cualquier clave del probe
// fuera de este set es un tag de terceros que el inspector debe mostrar.
export const MANAGED_ALIASES: Set<string> = new Set(
  TAG_FIELDS.flatMap((field) => field.aliases.map((a) => a.toLowerCase())),
)
