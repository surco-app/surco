import { type Mpeg1Xing, mpeg1XingOfFile } from './rekordboxTimeline'

const XING_FRAME_SAMPLES = 1152
const ENCODER_DELAY_SAMPLES = 1105

// Measured in Traktor Pro 4.5.1 on 31/10/2026: Traktor plays an MP3's Xing/LAME frame as
// silence and keeps the encoder delay, which ffmpeg skips when the header is there. The
// converted file holds what ffmpeg decoded, so a cue moves by what Traktor draws ahead of
// the output's audio minus what it drew ahead of the audio ffmpeg took from the source.
// null stands for PCM, which both read alike. cueShiftFor subtracts it from its shift.
export function automaticCueOffsetMs(source: Mpeg1Xing | null, output: Mpeg1Xing | null): number {
  const drawnAhead = output
    ? ((output.xing ? XING_FRAME_SAMPLES : 0) + ENCODER_DELAY_SAMPLES) / output.sampleRate
    : 0
  const skippedByFfmpeg = source?.xing
    ? (XING_FRAME_SAMPLES + ENCODER_DELAY_SAMPLES) / source.sampleRate
    : 0
  return (drawnAhead - skippedByFfmpeg) * 1000
}

export async function automaticCueOffsetOfFiles(input: string, output: string): Promise<number> {
  return automaticCueOffsetMs(await mpeg1XingOfFile(input), await mpeg1XingOfFile(output))
}
