import type { DjProgram, UsbProgram } from '../../shared/djProgram'
import type { BatteryFormat } from './testLibrary'

const RATE = 44100
const MP3_FRAME = 1152
const LAVC_ENCODER_DELAY = 576
const MP3_DECODER_DELAY = 529
const AAC_PRIMING = 1024

const samplesMs = (samples: number): number => (samples / RATE) * 1000

const REKORDBOX_MP3_LEAD_MS = samplesMs(MP3_FRAME)
const TRAKTOR_MP3_DRAWN_AHEAD_MS = samplesMs(MP3_FRAME + LAVC_ENCODER_DELAY + MP3_DECODER_DELAY)
const REKORDBOX_M4A_LEAD_MS = samplesMs(AAC_PRIMING)

export type ConvertedFormat = 'mp3' | 'flac'

export const CONVERSION_MOVE_MS: Record<DjProgram, Record<ConvertedFormat, number>> = {
  rekordbox: { mp3: -REKORDBOX_MP3_LEAD_MS, flac: 0 },
  traktor: { mp3: -TRAKTOR_MP3_DRAWN_AHEAD_MS, flac: 0 },
  engine: { mp3: 0, flac: 0 },
  serato: { mp3: 0, flac: 0 },
  virtualdj: { mp3: 0, flac: 0 },
}

export const STICK_MOVE_MS: Record<UsbProgram, Partial<Record<BatteryFormat, number>>> = {
  rekordbox: { wav: 0, aiff: 0, flac: 0, mp3: 0, m4a: 0 },
  traktor: { wav: 0, aiff: 0, flac: 0 },
  engine: { wav: 0, aiff: 0, flac: 0, mp3: 0, m4a: 0 },
  serato: { wav: 0, aiff: 0, flac: 0, mp3: REKORDBOX_MP3_LEAD_MS, m4a: REKORDBOX_M4A_LEAD_MS },
  virtualdj: { wav: 0, aiff: 0, flac: 0, mp3: REKORDBOX_MP3_LEAD_MS, m4a: REKORDBOX_M4A_LEAD_MS },
}

export const STICK_CUES_LEFT_OUT: Record<UsbProgram, ReadonlySet<BatteryFormat>> = {
  rekordbox: new Set(),
  traktor: new Set(['m4a']),
  engine: new Set(),
  serato: new Set(),
  virtualdj: new Set(),
}
