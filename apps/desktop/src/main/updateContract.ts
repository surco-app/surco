import { extname } from 'node:path'
import type { OutputFormat } from '../shared/types'
import { prepareProcessedCover } from './cover'
import { convertAudio, readTags } from './ffmpeg'

// The contract behind "update": converting a file into its own format changes only what
// the lists below say, and a second pass changes nothing. Shared by the synthetic matrix
// (convertUpdateContract.test.ts) and the corpus of real files (tagCorpus.test.ts), so a
// deliberate change is declared once and a real file is held to the same rules.

export type UpdateExt = 'flac' | 'mp3' | 'aiff' | 'wav' | 'm4a'

export const UPDATE_FORMAT: Record<UpdateExt, OutputFormat> = {
  flac: 'flac',
  mp3: 'mp3',
  aiff: 'aiff',
  wav: 'wav',
  m4a: 'alac',
}

export function updateExtOf(file: string): UpdateExt | null {
  const ext = extname(file).toLowerCase().replace(/^\./, '')
  if (ext === 'aif') return 'aiff'
  return ext in UPDATE_FORMAT ? (ext as UpdateExt) : null
}

// The changes a first pass is allowed to make to a file another tagger left, each one a
// decision taken elsewhere on purpose. Anything outside these lists is a field the
// update invented, renamed, duplicated or lost — the four kinds a user found comparing
// a FLAC before and after in mp3tag (17/09/2026). Every entry names its reason so the
// list reads as a contract, not as a way to make the test pass.
export const ALLOWED_UPDATE_CHANGES: Record<UpdateExt, { added: RegExp[]; removed: RegExp[] }> = {
  flac: {
    added: [
      // The label under both names Traktor and the shops read (tagFields: vorbisAlso).
      /^xiph (LABEL|PUBLISHER)=/,
      // The key under the second name rekordbox reads (tagFields: vorbisAlso).
      /^xiph KEY=/,
      // TagLib spells the BPM TEMPO; Surco writes the BPM name DJ software reads.
      /^xiph BPM=/,
      // Art in any other format is transcoded to JPEG, the one format every consumer takes.
      /^picture type=3 mime=image\/jpeg /,
    ],
    removed: [
      // The label's third spelling, cleared so it cannot resurface beside the two written.
      /^xiph ORGANIZATION=/,
      /^xiph TEMPO=/,
      // The encoder's own stamp.
      /^xiph ENCODER=/,
      /^picture type=3 mime=image\/png /,
    ],
  },
  mp3: {
    added: [
      // Surco writes ID3v2.3 (TYER) for the readers that never learned 2.4's TDRC.
      /^id3 TYER=/,
      // The picture is re-described as "<album>.jpg", which mp3tag and DJ software show.
      /^id3 APIC\[type=3,mime=image\/jpeg,desc=/,
    ],
    removed: [/^id3 TDRC=/, /^id3 APIC\[type=3,/],
  },
  aiff: {
    added: [/^id3 TYER=/, /^id3 APIC\[type=3,mime=image\/jpeg,desc=/],
    removed: [/^id3 TDRC=/, /^id3 APIC\[type=3,/],
  },
  wav: {
    added: [
      /^id3 TYER=/,
      /^id3 APIC\[type=3,mime=image\/jpeg,desc=/,
      /^picture type=3 mime=image\/jpeg /,
      // ffmpeg's INFO spelling of the album and artist, written beside TagLib's DIRC/ISTR.
      /^riff IPRD=/,
      /^riff IART=/,
    ],
    removed: [
      /^id3 TDRC=/,
      /^id3 APIC\[type=3,/,
      /^picture type=3 mime=image\/png /,
      // The encoder's own stamp.
      /^riff ISFT=/,
    ],
  },
  m4a: {
    added: [/^mp4 covr=/, /^picture type=3 mime=image\/jpeg /],
    removed: [/^mp4 ©too=/, /^mp4 covr=/, /^picture type=3 mime=image\/png /],
  },
}

// What "update" does with a track whose cover is the file's own: the job names the file
// as the art source, main pulls the picture out and runs it through the cover settings,
// and the editor's values (readMeta's tags) are what the conversion writes back.
export async function updateLikeTheApp(
  input: string,
  output: string,
  ext: UpdateExt,
): Promise<void> {
  const prepared = await prepareProcessedCover(
    { coverFromFile: input },
    { maxSize: 1200, square: false, upscale: false },
  )
  try {
    await convertAudio(input, output, UPDATE_FORMAT[ext], await readTags(input), prepared?.path)
  } finally {
    await prepared?.cleanup()
  }
}

export function unexplainedChanges(lines: string[], rules: RegExp[]): string[] {
  return lines.filter((l) => !rules.some((r) => r.test(l)))
}
