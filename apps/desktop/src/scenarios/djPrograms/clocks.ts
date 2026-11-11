import type { DjProgram } from '../../shared/djProgram'

const RATE = 44100
const MP3_FRAME = 1152
const LAVC_ENCODER_DELAY = 576
const MP3_DECODER_DELAY = 529

const samplesMs = (samples: number): number => (samples / RATE) * 1000

const REKORDBOX_MP3_LEAD_MS = samplesMs(MP3_FRAME)
const TRAKTOR_MP3_DRAWN_AHEAD_MS = samplesMs(MP3_FRAME + LAVC_ENCODER_DELAY + MP3_DECODER_DELAY)

export type ConvertedFormat = 'mp3' | 'flac'

export const CONVERSION_MOVE_MS: Record<DjProgram, Record<ConvertedFormat, number>> = {
  rekordbox: { mp3: -REKORDBOX_MP3_LEAD_MS, flac: 0 },
  traktor: { mp3: -TRAKTOR_MP3_DRAWN_AHEAD_MS, flac: 0 },
  engine: { mp3: 0, flac: 0 },
  serato: { mp3: 0, flac: 0 },
  virtualdj: { mp3: 0, flac: 0 },
}
